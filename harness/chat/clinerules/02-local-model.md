# Working under a 27B local model

This workspace is driven by a 27B model served locally, with a **16,384 token output
cap that its reasoning is also paid out of**, and it degrades when it explores.

- **Do not list directories or read files for orientation.** Everything you need is in
  the task statement or already attached. If something is genuinely unreadable, name
  the symbol you cannot resolve and stop — do not guess and do not go hunting.
- **Write whole files.** Never a partial file with an "unchanged" comment in the middle.
- **One file per response** when a file runs past about 150 lines. Two large files in
  one answer is how the output cap gets hit, and a truncated file is worse than none.
- **Never create a file the task did not ask for**, and never improve code you were not
  asked to change.
