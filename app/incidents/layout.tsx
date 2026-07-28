import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient } from "@/lib/supabase/server";
import { getViewerTeam } from "./data";

/**
 * Reads cookies, so under Cache Components it has to live behind a Suspense
 * boundary rather than in the static shell.
 */
async function NavIdentity() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const team = await getViewerTeam();

  return (
    <>
      {team && (
        <span className="text-muted-foreground" data-testid="current-team-name">
          {team.name}
        </span>
      )}
      <span
        className="ml-auto hidden sm:inline text-muted-foreground"
        data-testid="current-user-email"
      >
        {user.email}
      </span>
    </>
  );
}

export default function IncidentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
        <div className="w-full max-w-5xl flex items-center gap-4 p-3 px-5 text-sm">
          <Link href="/incidents" className="font-semibold">
            Incident desk
          </Link>
          <Suspense fallback={<span className="ml-auto" />}>
            <NavIdentity />
          </Suspense>
          <LogoutButton />
        </div>
      </nav>

      <div className="w-full max-w-5xl flex-1 flex flex-col gap-8 p-5">
        {children}
      </div>

      <footer className="w-full flex items-center justify-center border-t text-center text-xs gap-8 py-8">
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
