import { operatorEmail } from "@/lib/site";

export function OperatorContact() {
  const email = operatorEmail();
  if (!email) return <>the operator of this deployment</>;
  return <a href={`mailto:${email}`}>{email}</a>;
}
