# 02-trip.entity.ts

## reasoning

```
The user wants me to write exactly one file: `src/modules/trips/entities/trip.entity.ts` based on the plan.

From the plan, section 3, the Trip interface is:

```ts
export interface Trip {
  id: number;
  name: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

This is straightforward. The plan explicitly specifies this interface with no additional imports needed (Date is a built-in type). No ASSUMPTION comments are needed since everything is clearly specified.

Let me write the complete file.
```

## reply

```ts
export interface Trip {
  id: number;
  name: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```
