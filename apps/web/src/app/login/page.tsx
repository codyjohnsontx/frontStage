import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

const devLoginEnabled =
  process.env.ENABLE_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);
const microsoftEnabled = Boolean(process.env.MICROSOFT_CLIENT_ID);

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/orgs");

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Frontstage</h1>
        <p className="muted">Keep the work backstage. Keep clients in the loop.</p>

        {googleEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/orgs" });
            }}
          >
            <button type="submit" style={{ width: "100%", marginBottom: "0.5rem" }}>
              Continue with Google
            </button>
          </form>
        )}

        {microsoftEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/orgs" });
            }}
          >
            <button type="submit" style={{ width: "100%", marginBottom: "0.5rem" }}>
              Continue with Microsoft
            </button>
          </form>
        )}

        {!googleEnabled && !microsoftEnabled && (
          <p className="muted">
            No OAuth providers are configured yet. Set GOOGLE_CLIENT_ID /
            MICROSOFT_CLIENT_ID in the environment.
          </p>
        )}

        {devLoginEnabled && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />
            <p className="muted" style={{ marginTop: 0 }}>
              Development sign-in (local only)
            </p>
            <form
              action={async (formData: FormData) => {
                "use server";
                await signIn("dev-login", {
                  email: String(formData.get("email") ?? ""),
                  name: String(formData.get("name") ?? ""),
                  redirectTo: "/orgs",
                });
              }}
            >
              <div style={{ display: "grid", gap: "0.5rem" }}>
                <input name="name" placeholder="Your name" required aria-label="Name" />
                <input name="email" type="email" placeholder="you@example.com" required aria-label="Email" />
                <button type="submit" className="secondary">
                  Dev sign-in
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
