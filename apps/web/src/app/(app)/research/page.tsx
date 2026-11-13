import { Suspense } from 'react';
import { ResearchPage } from '@/components/app/research';

export default function Research() {
  // ResearchPage reads ?id=… (an open research).
  return (
    <Suspense>
      <ResearchPage />
    </Suspense>
  );
}
