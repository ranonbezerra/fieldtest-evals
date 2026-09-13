export enum PayoutStatus {
  PENDING = "PENDING",
  AWAITING_SET = "AWAITING_SET",
  SETTLED = "SETTLED",
  REJECTED = "REJECTED",
  PARKED = "PARKED",
}

export enum SendOutcome {
  ACCEPTED = "accepted",
  DUPLICATE = "duplicate",
  TRANSIENT = "transient",
  PERMANENT = "permanent",
}
