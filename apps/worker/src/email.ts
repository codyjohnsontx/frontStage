import nodemailer from "nodemailer";
import { z } from "zod";

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
});

export const invitationEmailPayload = z.object({
  invitationId: z.string(),
  email: z.string().email(),
  organizationName: z.string(),
  invitedByName: z.string(),
  roleKey: z.string(),
  acceptUrl: z.string().url(),
  expiresAt: z.string(),
});

export type InvitationEmailPayload = z.infer<typeof invitationEmailPayload>;

export async function sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
  const role = payload.roleKey.toLowerCase().replace(/_/g, " ");
  const expires = new Date(payload.expiresAt).toUTCString();
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Frontstage <no-reply@frontstage.local>",
    to: payload.email,
    subject: `${payload.invitedByName} invited you to ${payload.organizationName} on Frontstage`,
    text: [
      `${payload.invitedByName} invited you to join ${payload.organizationName} on Frontstage as ${role}.`,
      "",
      `Accept the invitation: ${payload.acceptUrl}`,
      "",
      `This link is bound to ${payload.email}, is single-use, and expires ${expires}.`,
      "If you weren't expecting this invitation you can ignore this email.",
    ].join("\n"),
  });
}
