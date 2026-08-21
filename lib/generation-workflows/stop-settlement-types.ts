export type StopSettlementParams = {
  profileId: string;
  jobId: string;
  userId: string;
};

export type StopSettlementResult = {
  action: "noop_terminal" | "settled" | "settled_no_refund";
  refunded: boolean;
  refundEligible: boolean;
  replay?: boolean;
};
