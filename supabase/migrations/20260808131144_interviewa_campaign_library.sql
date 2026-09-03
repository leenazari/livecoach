insert into public.outreach_campaigns (name, goal, audience, offer_angle, status, sequence)
values
  (
    'Interviewa admissions teams',
    'Book a demonstration with an admissions or student-success leader',
    'Universities, colleges and training providers preparing applicants or students for interviews',
    'Give learners realistic interview practice at scale, with structured feedback before a real admissions or placement interview',
    'draft',
    '[{"step":1,"delayDays":0,"purpose":"Connect their learner journey to practice"},{"step":2,"delayDays":4,"purpose":"Show the scalable preparation angle"},{"step":3,"delayDays":8,"purpose":"Short close-the-loop message"}]'::jsonb
  ),
  (
    'Interviewa employer hiring teams',
    'Book a focused demonstration with a hiring or talent leader',
    'Employers with repeat hiring, assessment or candidate-experience needs',
    'Help candidates prepare consistently and give hiring teams a clearer, more confident interview experience without replacing human decisions',
    'draft',
    '[{"step":1,"delayDays":0,"purpose":"Lead with their hiring context"},{"step":2,"delayDays":4,"purpose":"Add candidate experience value"},{"step":3,"delayDays":8,"purpose":"Short close-the-loop message"}]'::jsonb
  ),
  (
    'Interviewa training and L&D',
    'Book a demonstration with a learning or sales enablement leader',
    'Training providers and internal L&D teams using practice, role-play or coaching',
    'Provide realistic repeatable role-play and interview practice, with useful coaching feedback between live training sessions',
    'draft',
    '[{"step":1,"delayDays":0,"purpose":"Connect Interviewa to practice at scale"},{"step":2,"delayDays":4,"purpose":"Show the coaching-between-sessions angle"},{"step":3,"delayDays":8,"purpose":"Short close-the-loop message"}]'::jsonb
  )
on conflict (name) do nothing;
