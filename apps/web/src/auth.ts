import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getPrisma } from "@frontstage/database";
import { upsertUserFromSignIn } from "@/server/users";

/**
 * OAuth providers are registered only when credentials exist in the
 * environment. The Credentials provider is a DEV-ONLY convenience for local
 * work before OAuth apps are registered; it is hard-disabled outside
 * development.
 */
const devLoginEnabled =
  process.env.ENABLE_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

const providers: Provider[] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev sign-in (local only)",
      credentials: {
        email: { label: "Email", type: "email" },
        name: { label: "Name", type: "text" },
      },
      async authorize(raw) {
        const parsed = z
          .object({ email: z.string().email(), name: z.string().min(1) })
          .safeParse(raw);
        if (!parsed.success) return null;
        const user = await upsertUserFromSignIn(getPrisma(), {
          email: parsed.data.email.toLowerCase(),
          name: parsed.data.name,
          provider: null,
          providerAccountId: null,
        });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

const config: NextAuthConfig = {
  providers,
  session: {
    // JWT sessions for the pilot; revocable DB sessions arrive with the
    // portal security-policy work (docs/security.md "known gaps").
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // On OAuth sign-in, persist the user + provider account and store our
      // internal user id on the token.
      if (account && account.provider !== "dev-login" && token.email) {
        const provider =
          account.provider === "google"
            ? ("GOOGLE" as const)
            : ("MICROSOFT" as const);
        const dbUser = await upsertUserFromSignIn(getPrisma(), {
          email: token.email.toLowerCase(),
          name: token.name ?? null,
          provider,
          providerAccountId: account.providerAccountId,
        });
        token.userId = dbUser.id;
      } else if (user?.id && !token.userId) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
