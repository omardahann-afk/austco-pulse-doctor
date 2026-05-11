# Claude Full Diagnosis Flow

Required flow:

1. Logs collected off all selected appliances
2. Logs stored
3. Logs normalized
4. Known Tacera noise suppressed
5. Deterministic root-cause engine runs
6. Claude translates/correlates into human language
7. Output includes next steps and developer proof

Claude does NOT override deterministic truth.

Claude explains:
- what failed
- where it failed
- why it failed
- what happened first
- what is downstream symptom
- what can be ignored
- what to check next
- what not to touch
- what to send to dev/support

Important:
No passwords, SSH keys, tokens, or raw credentials are sent.
