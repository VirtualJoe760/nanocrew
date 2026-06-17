import { Footer } from '../site-chrome';
import { StoreNav } from './store-nav';

// The cart provider lives in the root layout (shared with /b/<brand> pages); this layout just adds
// the store chrome.
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StoreNav />
      {children}
      <Footer />
    </>
  );
}
