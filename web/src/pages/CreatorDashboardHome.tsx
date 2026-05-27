import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorDashboardHome() {
  return (
    <CreatorDashboardSkeleton
      title="Creator Dashboard"
      eyebrow="Creator overview"
      description="Track received tips, post performance, payout readiness, and the next action that helps you turn support into momentum."
      sections={[
        { title: "Next best action", body: "Will surface verify, payout setup, withdraw, share, or post momentum actions based on creator state.", icon: "bolt" },
        { title: "Recent support", body: "Will list direct tips, post tips, claim status, and receipt actions from confirmed activity.", icon: "receipt_long" },
      ]}
    />
  );
}
