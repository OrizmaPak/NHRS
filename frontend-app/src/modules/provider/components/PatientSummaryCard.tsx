import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

type Props = {
  name: string;
  nin: string;
  age?: string | number;
  gender?: string;
  subtitle?: string;
};

export function PatientSummaryCard({ name, nin, age, gender, subtitle }: Props) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{name}</CardTitle>
          <CardDescription>{subtitle ?? 'Patient clinical summary'}</CardDescription>
        </div>
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">NIN</p>
          <p className="font-medium text-foreground">{nin}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Age</p>
          <p className="font-medium text-foreground">{age ?? 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Gender</p>
          <p className="font-medium text-foreground">{gender ?? 'N/A'}</p>
        </div>
      </div>
    </Card>
  );
}
