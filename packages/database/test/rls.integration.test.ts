/**
 * Cross-tenant probe suite (Phase 0 exit criterion: "two organizations
 * cannot access each other's data").
 *
 * Provisions a dedicated `frontstage_test` database, applies all migrations,
 * seeds two organizations as the table owner, then attacks the row-level
 * security policies as the runtime `frontstage_app` role.
 *
 * Requires the local dev Postgres from docker-compose (port 5434).
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withRlsContext } from "../src/index";

const HOST = "localhost:5434";
const ADMIN_URL = `postgresql://frontstage:frontstage_dev@${HOST}/postgres`;
const OWNER_TEST_URL = `postgresql://frontstage:frontstage_dev@${HOST}/frontstage_test`;
const APP_TEST_URL = `postgresql://frontstage_app:frontstage_app_dev@${HOST}/frontstage_test`;

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ALICE = "11111111-1111-4111-8111-111111111111"; // member of A only
const USER_BOB = "22222222-2222-4222-8222-222222222222"; // member of B only

let owner: PrismaClient;
let app: PrismaClient;

beforeAll(async () => {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS frontstage_test WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE frontstage_test`);
  await admin.$disconnect();

  execSync("pnpm prisma migrate deploy", {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: OWNER_TEST_URL },
    stdio: "pipe",
  });

  owner = new PrismaClient({ datasourceUrl: OWNER_TEST_URL });
  app = new PrismaClient({ datasourceUrl: APP_TEST_URL });

  // Seed as the superuser owner (bypasses RLS in dev).
  await owner.user.createMany({
    data: [
      { id: USER_ALICE, email: "alice@org-a.test", name: "Alice" },
      { id: USER_BOB, email: "bob@org-b.test", name: "Bob" },
    ],
  });
  await owner.organization.createMany({
    data: [
      { id: ORG_A, name: "Org A", slug: "org-a" },
      { id: ORG_B, name: "Org B", slug: "org-b" },
    ],
  });
  const membershipA = await owner.organizationMembership.create({
    data: { organizationId: ORG_A, userId: USER_ALICE },
  });
  await owner.organizationMembership.create({
    data: { organizationId: ORG_B, userId: USER_BOB },
  });
  await owner.scopedRoleAssignment.create({
    data: {
      organizationId: ORG_A,
      membershipId: membershipA.id,
      roleKey: "ORGANIZATION_OWNER",
      scopeType: "ORGANIZATION",
    },
  });
  await owner.invitation.createMany({
    data: [
      {
        organizationId: ORG_A,
        email: "invitee@org-a.test",
        roleKey: "CONTRIBUTOR",
        scopeType: "ORGANIZATION",
        tokenHash: "hash-a",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: USER_ALICE,
      },
      {
        organizationId: ORG_B,
        email: "invitee@org-b.test",
        roleKey: "CONTRIBUTOR",
        scopeType: "ORGANIZATION",
        tokenHash: "hash-b",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: USER_BOB,
      },
    ],
  });
  await owner.auditEvent.createMany({
    data: [
      { organizationId: ORG_A, actorType: "SYSTEM", action: "seed", resourceType: "test" },
      { organizationId: ORG_B, actorType: "SYSTEM", action: "seed", resourceType: "test" },
    ],
  });
});

afterAll(async () => {
  await owner?.$disconnect();
  await app?.$disconnect();
});

describe("app role with NO context", () => {
  it("sees no tenant data at all", async () => {
    expect(await app.organization.count()).toBe(0);
    expect(await app.organizationMembership.count()).toBe(0);
    expect(await app.scopedRoleAssignment.count()).toBe(0);
    expect(await app.invitation.count()).toBe(0);
    expect(await app.auditEvent.count()).toBe(0);
  });
});

describe("app role with org A context", () => {
  it("sees only org A rows in every tenant table", async () => {
    await withRlsContext(app, { organizationId: ORG_A }, async (tx) => {
      const orgs = await tx.organization.findMany();
      expect(orgs.map((o) => o.id)).toEqual([ORG_A]);
      const memberships = await tx.organizationMembership.findMany();
      expect(memberships.every((m) => m.organizationId === ORG_A)).toBe(true);
      expect(memberships.length).toBe(1);
      const invitations = await tx.invitation.findMany();
      expect(invitations.map((i) => i.email)).toEqual(["invitee@org-a.test"]);
      const audit = await tx.auditEvent.findMany();
      expect(audit.every((a) => a.organizationId === ORG_A)).toBe(true);
    });
  });

  it("cannot write rows into org B (WITH CHECK rejects)", async () => {
    await expect(
      withRlsContext(app, { organizationId: ORG_A }, (tx) =>
        tx.organizationMembership.create({
          data: { organizationId: ORG_B, userId: USER_ALICE },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withRlsContext(app, { organizationId: ORG_A }, (tx) =>
        tx.auditEvent.create({
          data: {
            organizationId: ORG_B,
            actorType: "USER",
            action: "forged",
            resourceType: "test",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-org updates match zero rows instead of leaking", async () => {
    const result = await withRlsContext(app, { organizationId: ORG_A }, (tx) =>
      tx.invitation.updateMany({
        where: { organizationId: ORG_B },
        data: { status: "REVOKED" },
      }),
    );
    expect(result.count).toBe(0);
    const bInvite = await owner.invitation.findFirst({ where: { organizationId: ORG_B } });
    expect(bInvite?.status).toBe("PENDING");
  });
});

describe("identity context", () => {
  it("a user sees their own memberships and orgs, not others", async () => {
    await withRlsContext(app, { userId: USER_ALICE }, async (tx) => {
      const memberships = await tx.organizationMembership.findMany();
      expect(memberships.map((m) => m.organizationId)).toEqual([ORG_A]);
      const orgs = await tx.organization.findMany();
      expect(orgs.map((o) => o.id)).toEqual([ORG_A]);
    });
  });

  it("invitations are visible only to the invited email (email binding)", async () => {
    await withRlsContext(app, { userEmail: "invitee@org-a.test" }, async (tx) => {
      const invitations = await tx.invitation.findMany();
      expect(invitations.map((i) => i.tokenHash)).toEqual(["hash-a"]);
    });
    // The wrong identity cannot even see the row, let alone accept it.
    await withRlsContext(app, { userEmail: "attacker@evil.test" }, async (tx) => {
      expect(await tx.invitation.count()).toBe(0);
    });
  });

  it("the invited email cannot update someone else's invitation", async () => {
    const result = await withRlsContext(app, { userEmail: "invitee@org-a.test" }, (tx) =>
      tx.invitation.updateMany({
        where: { tokenHash: "hash-b" },
        data: { status: "ACCEPTED" },
      }),
    );
    expect(result.count).toBe(0);
  });
});

describe("audit append-only", () => {
  it("rejects UPDATE and DELETE even for the table owner", async () => {
    const event = await owner.auditEvent.findFirstOrThrow({
      where: { organizationId: ORG_A },
    });
    await expect(
      owner.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});
