# Political module

The generic map renderer does not assume political data. The political module will bind constituency entities to election periods, candidates, parties, results, turnout, margin, and historical trend.

The current UI deliberately shows a clear unavailable state when result data is not bound. No party, winner, turnout, or margin values are included in the demo fixture. The intended binding keys are stable official constituency IDs first, then a reviewed name/parent match with unmatched rows reported.
