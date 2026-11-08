import { redirect } from 'next/navigation';

/** "Accounts" became "Connections" (ADR-0018): old links and in-flight OAuth returns land there. */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, v);
    }
  }
  const query = params.toString();
  redirect(query ? `/connections?${query}` : '/connections');
}
