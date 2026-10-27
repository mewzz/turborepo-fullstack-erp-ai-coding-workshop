import { useParams } from 'react-router';
import { GoodsReceiving } from '@/components/goods-receiving';

export function GoodsReceivingPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <GoodsReceiving key={id} purchaseOrderId={id} /> : null;
}
