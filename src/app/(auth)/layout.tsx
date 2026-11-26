import { AuthFrame } from "@/components/branding/AuthFrame";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
