import { createBrowserRouter } from 'react-router';
import { RequireAuth } from '@/components/require-auth';
import { GoodsReceivingPage } from '@/routes/goods-receiving';
import { HomePage } from '@/routes/home';
import { LoginPage } from '@/routes/login';
import { ProductsPage } from '@/routes/products';
import { PurchaseOrdersPage } from '@/routes/purchase-orders';
import { RootLayout } from '@/routes/root-layout';
import { StockPage } from '@/routes/stock';
import { SuppliersPage } from '@/routes/suppliers';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    // Everything below requires a signed-in user.
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <RootLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'products', element: <ProductsPage /> },
          { path: 'stock', element: <StockPage /> },
          { path: 'suppliers', element: <SuppliersPage /> },
          { path: 'purchase-orders', element: <PurchaseOrdersPage /> },
          { path: 'purchase-orders/:id/receive', element: <GoodsReceivingPage /> },
        ],
      },
    ],
  },
]);
