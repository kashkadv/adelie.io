'use client';

import { useParams } from 'next/navigation';
import { ConnectInvite } from '@/components/connect-invite';

/** Public: a connect invitation link (ADR-0012). */
export default function ConnectInvitePage() {
  const { token } = useParams<{ token: string }>();
  return <ConnectInvite token={token} />;
}
