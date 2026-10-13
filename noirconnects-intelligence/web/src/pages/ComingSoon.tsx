import { Card, Notice, PageHeader } from '../components/ui';
import type { NavItem } from '../lib/nav';

/** Honest placeholder for sections delivered in later phases. Contains no inert controls. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.summary} />
      <Card className="p-5">
        <Notice>
          This section is delivered in <strong>Phase {item.phase}</strong> of the build. Nothing here is active yet, and no
          actions can be taken from this page. The underlying database tables already exist, so the Overview counts for this
          area are real (currently derived from empty tables).
        </Notice>
      </Card>
    </>
  );
}
