import { NavLink, Outlet } from 'react-router';
import { UserMenu } from '@/components/user-menu';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'หน้าแรก', end: true },
  { to: '/products', label: 'สินค้า', end: false },
  { to: '/stock', label: 'สต็อก', end: false },
  { to: '/suppliers', label: 'ผู้จัดจำหน่าย', end: false },
  { to: '/purchase-orders', label: 'ใบสั่งซื้อ', end: false },
];

export function RootLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <span className="font-semibold">ERP Workshop</span>
            <nav className="flex items-center gap-4 text-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'text-muted-foreground transition-colors hover:text-foreground',
                      isActive && 'font-medium text-foreground',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
