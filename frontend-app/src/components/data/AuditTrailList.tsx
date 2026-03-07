import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';

const auditItems = [
  {
    id: 'a1',
    title: 'Role updated',
    badge: 'RBAC',
    timestamp: new Date().toISOString(),
    detail: 'org_admin granted provider.patient.read in org-001',
  },
  {
    id: 'a2',
    title: 'Profile updated',
    badge: 'Profile',
    timestamp: new Date().toISOString(),
    detail: 'Notification preferences changed to email + sms',
  },
];

export function AuditTrailList() {
  return (
    <Timeline>
      {auditItems.map((item) => (
        <TimelineItem key={item.id} title={item.title} badge={item.badge} timestamp={item.timestamp}>
          {item.detail}
        </TimelineItem>
      ))}
    </Timeline>
  );
}
