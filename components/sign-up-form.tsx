"use client";

import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hydrated = useHydrated();
  const router = useRouter();

  // The fields are uncontrolled and read from FormData on submit. Controlled
  // inputs would discard anything typed before hydration, which is a real
  // race for fast typists and for anything automating the browser.
  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const repeatPassword = String(form.get("repeat-password") ?? "");
    const team = String(form.get("team-name") ?? "").trim();

    setError(null);

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!team) {
      setError("Enter the team you're joining");
      return;
    }

    const supabase = createClient();
    setIsLoading(true);

    try {
      // The team name is read by the signup trigger, which joins the named
      // team or creates it. No invite, no approval.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/incidents`,
          data: { team_name: team },
        },
      });
      if (error) throw error;

      if (data.session) {
        // Confirmations are off, so the session is already live — send them
        // straight into the desk rather than to a "check your email" page for
        // a mail that was never sent.
        router.push("/incidents");
        router.refresh();
      } else {
        router.push("/auth/sign-up-success");
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>
            Create an account and join your team&apos;s incident desk
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  data-testid="signup-email"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="team-name">Team</Label>
                <Input
                  id="team-name"
                  name="team-name"
                  type="text"
                  placeholder="Northwind NOC"
                  required
                  maxLength={80}
                  data-testid="signup-team-name"
                />
                <p className="text-xs text-muted-foreground">
                  You&apos;ll join this team if it already exists, or create it
                  if it doesn&apos;t.
                </p>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  data-testid="signup-password"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repeat Password</Label>
                </div>
                <Input
                  id="repeat-password"
                  name="repeat-password"
                  type="password"
                  required
                  data-testid="signup-repeat-password"
                />
              </div>
              {error && (
                <p className="text-sm text-red-500" data-testid="signup-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !hydrated}
                data-testid="signup-submit"
              >
                {isLoading ? "Creating an account..." : "Sign up"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link href="/auth/login" className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
