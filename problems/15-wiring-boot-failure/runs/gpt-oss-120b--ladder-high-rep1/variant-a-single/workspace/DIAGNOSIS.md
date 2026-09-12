# Wiring Diagnosis

## Defect 1 – Runtime circular import causing `ReferenceError: Cannot access 'QUEUES' before initialization`

**What happened:**  
`NotificationsService` imported `QUEUES` from `jobs.module.ts`.  
`jobs.module.ts` imported `NotificationsModule`, which in turn imported
`NotificationsService`. This created a circular module graph:

```
jobs.module → NotificationsModule → NotificationsService → jobs.module (QUEUES)
