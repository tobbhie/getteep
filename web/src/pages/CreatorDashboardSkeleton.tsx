import CreatorDashboardShell from "../components/CreatorDashboardShell";

type CreatorDashboardSkeletonProps = {
  title: string;
  eyebrow: string;
  description: string;
  primaryCards?: Array<{ label: string; value: string; detail: string; icon: string }>;
  sections?: Array<{ title: string; body: string; icon: string }>;
};

const defaultCards = [
  { label: "Available", value: "$0.00", detail: "Ready once tips are claimed", icon: "payments" },
  { label: "Posts tipped", value: "0", detail: "Post support appears here", icon: "forum" },
  { label: "Supporters", value: "0", detail: "Unique tippers tracked by Teep", icon: "groups" },
];

export default function CreatorDashboardSkeleton({
  title,
  eyebrow,
  description,
  primaryCards = defaultCards,
  sections = [],
}: CreatorDashboardSkeletonProps) {
  return (
    <CreatorDashboardShell title={title}>
      <main className="dashboard-body-inner creator-dashboard-skeleton">
        <section className="dashboard-page-heading">
          <div>
            <div className="dashboard-metric-label">{eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </section>

        <section className="dashboard-grid-3">
          {primaryCards.map((card) => (
            <div key={card.label} className="dashboard-metric-card">
              <div className="dashboard-metric-icon">
                <span className="material-symbols-outlined" aria-hidden>{card.icon}</span>
              </div>
              <div className="dashboard-metric-label">{card.label}</div>
              <div className="dashboard-metric-value">{card.value}</div>
              <p>{card.detail}</p>
            </div>
          ))}
        </section>

        <section className="dashboard-card" style={{ padding: "var(--space-6)" }}>
          <div className="dashboard-section-heading">
            <h3>Later implementation skeleton</h3>
          </div>
          <div className="dashboard-grid-2">
            {(sections.length ? sections : [
              { title: "Data source", body: "Wire this section to indexed creator activity before replacing the placeholder.", icon: "database" },
              { title: "Primary action", body: "Add the next action only when the backend flow exists.", icon: "bolt" },
            ]).map((section) => (
              <div key={section.title} className="dashboard-settings-list-row">
                <div>
                  <strong>{section.title}</strong>
                  <span>{section.body}</span>
                </div>
                <span className="material-symbols-outlined" aria-hidden>{section.icon}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </CreatorDashboardShell>
  );
}
