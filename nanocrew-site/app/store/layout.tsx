import { Footer } from '../site-chrome';
import { CartProvider } from './cart-store';
import { StoreNav } from './store-nav';

// Store routes live under one provider so the cart persists across grid → product → bag.
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <StoreNav />
      {children}
      <Footer />
    </CartProvider>
  );
}
