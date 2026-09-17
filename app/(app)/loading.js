import Skeleton from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="route-loading">
      <div className="skeleton-stack" style={{ marginBottom: 28 }}>
        <Skeleton width="220px" height={26} />
        <Skeleton width="60%" height={14} />
      </div>

      <div className="card">
        <div className="skeleton-stack">
          <Skeleton width="40%" height={16} />
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton width="70%" height={38} />
        </div>
      </div>
    </div>
  );
}
