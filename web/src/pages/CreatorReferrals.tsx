import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorReferrals() {
  return (
    <CreatorDashboardSkeleton
      title="Creator Referrals"
      eyebrow="Growth loop"
      description="Share Teep with supporters and creators, then track eligible referral activity and earnings."
      primaryCards={[
        { label: "Referral link", value: "Ready", detail: "Uses the shared referral card and account attribution logic.", icon: "link" },
        { label: "Referred users", value: "0", detail: "Will come from referral stats.", icon: "groups" },
        { label: "Earned", value: "$0.00", detail: "Referral earnings from eligible withdrawals.", icon: "payments" },
      ]}
      sections={[
        { title: "Fee split explainer", body: "Explain when referral earnings are created and where the money stays.", icon: "account_tree" },
        { title: "Anti-gaming rules", body: "Surface practical limits without making the page feel legal-heavy.", icon: "policy" },
      ]}
    />
  );
}
