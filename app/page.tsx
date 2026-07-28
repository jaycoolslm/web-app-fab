import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href="/">Incident desk</Link>
              <Link
                href="/incidents"
                className="font-normal text-muted-foreground hover:underline"
                data-testid="nav-incidents-link"
              >
                Incidents
              </Link>
            </div>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>

        <div className="flex-1 flex flex-col justify-center gap-8 max-w-2xl p-5 py-24 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">
            The network operations incident desk
          </h1>
          <p className="text-muted-foreground text-lg">
            Raise, triage and track incidents for your team. Every incident
            belongs to exactly one team, and no one outside that team can reach
            it.
          </p>
          <div className="flex justify-center gap-3">
            <Button asChild data-testid="home-open-incidents">
              <Link href="/incidents">Open the incident desk</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/auth/sign-up">Create an account</Link>
            </Button>
          </div>
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-8">
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
