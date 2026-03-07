import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { DataTable } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/feedback/StatusBadge';

type Doctor = {
  name: string;
  licenseNumber: string;
  specialization: string;
  status: 'active' | 'pending' | 'suspended';
};

const doctorData: Doctor[] = [
  { name: 'Dr. Chinedu Okafor', licenseNumber: 'MDCN-20444', specialization: 'Cardiology', status: 'active' },
  { name: 'Dr. Fatima Ibrahim', licenseNumber: 'MDCN-22001', specialization: 'Pediatrics', status: 'active' },
  { name: 'Dr. Tunde Balogun', licenseNumber: 'MDCN-19811', specialization: 'Orthopedics', status: 'pending' },
];

export function PublicDoctorSearchPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const columns = useMemo<ColumnDef<Doctor>[]>(
    () => [
      { accessorKey: 'name', header: 'Doctor' },
      { accessorKey: 'licenseNumber', header: 'License' },
      { accessorKey: 'specialization', header: 'Specialization' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certified Doctor Registry"
        description="Search verified clinicians nationally by specialization, location, and license details."
        breadcrumbs={[{ label: 'Public' }, { label: 'Doctor Registry' }]}
      />

      <DataTable
        columns={columns}
        data={doctorData}
        total={doctorData.length}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={1}
      />
    </div>
  );
}
