# TODO

- Making it into package:
  - Publish docker images so people can build upon them.
  - Mention we're inspired by strongmd (link to their article).
  - figure out how to package the entire setup.
    Basically we want the package to be triggerable on a remote server.
  - Try to run with the `forge` agent and set it as default if succesful
  - Test running multiple agents concurrently

- Tests:
  - dogfood - Use this package to define the software factory as specs + black box
  - e2e - use the dummy hello world proposal for an e2e test.

- Nice to have
  - Create a "container manager" that ensures that:
    - old images are deleted
    - containers are stopped, even if we CTRL+C once (on 2nd CTRL+C it's up to the user)
  - That we don't recreate the leash monitoring container multiple times

- Principles
  - Batteries included - sane defaults with minimal / no configuration needed
  - Customizable - bring your own coder script, language, source control, etc.

- Marketing:
  - ask slavic friend for any nerd ass engineers (rather, I need to post
    stuff that they themselves will share to signal their status - videos work best)
  - ask proptech
  - mention how this AI already makes us 7x faster, but this can 5x that even more.
    And at that volume, reviewing PRs becomes the bottleneck. Solution is spec-driven dev.
  - Ask for people to join the project.
  - FOMO - Don't fall behind the trends
  - Reach out to Apify folks that you'd like to implement AI-based scrapers and willing to work with them on that (ask for 12k/mo)

  - One more week and we could start offring this as solution to companies to try out AI safely
    - Bring AI to kubernetes
    - Reach out to kurtulik, he always has ideas
    - Rony ask for advice

## Other

- **Better docs prompts:**
  - We want to showcase in README that we integrate with many existing CLI agentic tools. you as a senior marketing specialist with vast experience with successful software projects, what would you recommend?
  - ok, next, we'll want to detailed info about individual CLI agent integrations. add docs/agents/README.md. Each integration will have separate file. but in that readme we'll describe the overall flow, what the integrations offer, when they run, etc. First gather relevant info, then rank it based on what's most important / relevant for the user, and only then write out the README.
