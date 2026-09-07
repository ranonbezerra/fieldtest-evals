import { useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { isActionable, useApproveOrder, useOrder, useRejectOrder } from './queries';

export function OrderDetailScreen() {
  const { id = '' } = useParams();
  const { data: order, isLoading } = useOrder(id);
  const approve = useApproveOrder();
  const reject = useRejectOrder();

  if (isLoading) return <p>Loading…</p>;
  if (!order) return <p>Order not found.</p>;

  const actionable = isActionable(order);
  const pending = approve.isPending || reject.isPending;

  const actions = (
    <div className="actions">
      <Button variant="primary" disabled={!actionable || pending} onClick={() => approve.mutate(order.id)}>
        Approve
      </Button>
      <Button variant="danger" disabled={!actionable || pending} onClick={() => reject.mutate(order.id)}>
        Reject
      </Button>
    </div>
  );

  return (
    <section>
      <h1>{order.reference}</h1>
      <Badge tone={order.status}>{order.status}</Badge>
      <p>{order.customer}</p>

      {actionable ? (
        actions
      ) : (
        <Tooltip label={`An order that is ${order.status} cannot be approved or rejected.`}>
          {actions}
        </Tooltip>
      )}
    </section>
  );
}
