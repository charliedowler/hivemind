import { AuthErrorPage } from "@/components/auth-error-page";

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return <AuthErrorPage reason={typeof error === "string" ? error : "unknown"} />;
}
