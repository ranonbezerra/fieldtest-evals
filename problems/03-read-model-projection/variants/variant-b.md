# Variant B — Bookings occupancy summary

A reservations platform shows property owners an occupancy dashboard: per
property and per month — nights booked, revenue, cancellation count. Source data
is normalized (bookings, booking_nights, adjustments, cancellations) and the
current aggregate query is unusably slow at ~5M bookings. Owners edit bookings
and expect the dashboard to reflect the change on the next page load; revenue
figures feed owner payouts, so they must be exact.

Build in **TypeScript + NestJS + Prisma + Postgres**: a monthly-summary
projection with DDL and indexes; in-transaction maintenance from the booking
write services (simulate create/cancel/adjust paths); re-derivation for any
(property, month); a scheduled drift-repair job; the new dashboard query; tests
for read-your-own-writes, concurrent adjustments to the same month, and repair
convergence. Include DESIGN.md with the trade-off discussion.
