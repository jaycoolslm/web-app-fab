import { DeskShell } from "@/components/desk-shell";

export default function BoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DeskShell current="/board">{children}</DeskShell>;
}
