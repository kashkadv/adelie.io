import { Suspense } from 'react';
import { Content } from '@/components/app/content';

export default function ContentPage() {
  // Content reads ?platform=…&post=… (a link from a product card opens that post).
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
