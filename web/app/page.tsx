'use client';

import { motion } from 'framer-motion';
import {
  Container,
  GitMerge,
  Lock,
  Network,
  RefreshCcw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0F0F0F] text-gray-200 selection:bg-[#00FF66] selection:text-black overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-saif-border bg-[#0F0F0F]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#00FF66] rounded-sm flex items-center justify-center text-black font-bold font-mono text-xs">
              S
            </div>
            <span className="font-mono font-bold tracking-tight text-white">SAIF</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <a
              href="https://github.com/JuroOravec/safe-ai-factory"
              className="text-gray-400 hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://github.com/JuroOravec/safe-ai-factory/blob/main/docs/usage.md"
              className="text-gray-400 hover:text-white transition-colors"
            >
              Docs
            </a>
            <a
              href="#sponsor"
              className="px-4 py-1.5 border border-[#333] hover:border-[#00FF66] text-white rounded-md transition-all font-mono text-xs"
            >
              Sponsor Project
            </a>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-24">
        {/* 1. Hero Section */}
        <section className="max-w-6xl mx-auto px-6 mb-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1A1A1A] border border-[#333] mb-8">
              <span className="w-2 h-2 rounded-full bg-[#00FF66] animate-pulse"></span>
              <span className="text-xs font-mono text-gray-300">Alpha Available Now</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white mb-6 leading-tight">
              Stop letting AI agents <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
                wreck your codebase.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              SAIF is a zero-trust orchestrator for containerized AI swarms. Write the specs, lock
              the agents in a sandbox, and let them grind until your tests pass.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://github.com/JuroOravec/safe-ai-factory"
                className="w-full sm:w-auto px-8 py-3 bg-white text-black font-medium rounded-md hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
              >
                <Terminal className="w-4 h-4" />
                Install the CLI
              </a>
              <div className="w-full sm:w-auto px-8 py-3 bg-[#1A1A1A] border border-[#333] font-mono text-sm rounded-md flex items-center justify-center gap-2 text-gray-300">
                <span className="text-[#00FF66]">$</span> npm i -g safe-ai-factory
              </div>
            </div>
          </motion.div>

          {/* Hero Visual Placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-20 relative rounded-xl border border-[#333] bg-[#111] overflow-hidden shadow-2xl glow-green mx-auto max-w-5xl aspect-video"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 font-mono text-sm border-dashed border-2 border-[#333] m-4 rounded-lg bg-[#0F0F0F]">
              <Terminal className="w-12 h-12 mb-4 opacity-50" />
              <p>
                [ PLACEHOLDER: Loop animation or GIF of VSCode sidebar showing a feature going from
                Design to Success ]
              </p>
              <p className="mt-2 opacity-50 text-xs">src: x_web/runs.png or x_web/workspace.png</p>
            </div>
          </motion.div>
        </section>

        {/* 2. The Problem */}
        <section className="bg-[#111] border-y border-[#333] py-24 mb-32">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl font-bold text-white mb-6">"Gas Town" is a liability.</h2>
                <p className="text-gray-400 mb-6 leading-relaxed">
                  The industry is obsessed with giving LLMs open-ended access to your terminal. It's
                  a chaotic mess where agents step on each other's toes, hallucinate dependencies,
                  and overwrite working code.
                </p>
                <ul className="space-y-4 font-mono text-sm">
                  <li className="flex items-start gap-3">
                    <span className="text-red-500 mt-1">✗</span>
                    <span className="text-gray-300">
                      <strong>Reward Hacking:</strong> Agents rewriting tests to fake a pass.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-red-500 mt-1">✗</span>
                    <span className="text-gray-300">
                      <strong>Context Rot:</strong> Agents getting confused after 10 loops and
                      breaking old features.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-red-500 mt-1">✗</span>
                    <span className="text-gray-300">
                      <strong>Security Risks:</strong> Agents exfiltrating data or pulling malicious
                      packages.
                    </span>
                  </li>
                </ul>
                <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-md">
                  <p className="text-red-400 font-medium">
                    You don't need a reckless AI intern. You need a factory assembly line.
                  </p>
                </div>
              </div>
              <div className="relative aspect-square md:aspect-auto md:h-full min-h-[400px] border border-[#333] rounded-lg bg-[#0F0F0F] flex items-center justify-center">
                <p className="text-gray-600 font-mono text-sm text-center px-6">
                  [ PLACEHOLDER: Diagram of chaotic AI agent messing up a codebase vs SAIF orderly
                  flow ]
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 3. The SAIF Solution */}
        <section className="max-w-6xl mx-auto px-6 mb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Five Degrees of Security</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Run agents fully unsupervised. SAIF provides the bulletproof vest you need to actually
              trust AI code generation.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-6 bg-[#111] border border-[#333] rounded-xl border-glow">
              <Container className="w-8 h-8 text-[#00FF66] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Docker Isolation</h3>
              <p className="text-gray-400 text-sm">
                Code runs in ephemeral containers. Your host machine is untouched. Secrets and .git
                are hidden.
              </p>
            </div>

            <div className="p-6 bg-[#111] border border-[#333] rounded-xl border-glow">
              <ShieldCheck className="w-8 h-8 text-[#00FF66] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Read-Only Tests</h3>
              <p className="text-gray-400 text-sm">
                The agent physically cannot modify the tests it's graded against. Zero reward
                hacking.
              </p>
            </div>

            <div className="p-6 bg-[#111] border border-[#333] rounded-xl border-glow">
              <Network className="w-8 h-8 text-[#00FF66] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Network Leash</h3>
              <p className="text-gray-400 text-sm">
                Outbound calls are blackholed via strict Cedar policies. No phoning home, no data
                leaks.
              </p>
            </div>

            <div className="p-6 bg-[#111] border border-[#333] rounded-xl border-glow">
              <RefreshCcw className="w-8 h-8 text-[#00FF66] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">The Ralph Wiggum Loop</h3>
              <p className="text-gray-400 text-sm">
                Agent memory is wiped clean every iteration. State lives in Git. Cures "context
                rot".
              </p>
            </div>

            <div className="p-6 bg-[#111] border border-[#333] rounded-xl border-glow md:col-span-2">
              <GitMerge className="w-8 h-8 text-[#00FF66] mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Human in the Loop</h3>
              <p className="text-gray-400 text-sm">
                You only review the final, passing PR. No intermediate garbage, no 400-line
                hallucinated drifts. Just clean code that already passes your test suite.
              </p>
            </div>
          </div>
        </section>

        {/* 4. Workflow Timeline */}
        <section className="max-w-4xl mx-auto px-6 mb-32">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">
            How SAIF 10x's your team
          </h2>

          <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[#333] before:to-transparent">
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[#00FF66] bg-[#0F0F0F] text-[#00FF66] font-mono font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_10px_rgba(0,255,102,0.2)] z-10">
                1
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-xl border border-[#333] bg-[#111]">
                <h3 className="font-bold text-white mb-1">The 1-Paragraph Idea</h3>
                <p className="text-gray-400 text-sm">
                  You write a tiny proposal: <em>"Add user login."</em>
                </p>
              </div>
            </div>

            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[#333] bg-[#0F0F0F] text-gray-400 font-mono font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                2
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-xl border border-[#333] bg-[#111]">
                <h3 className="font-bold text-white mb-1">The Autonomous Architect</h3>
                <p className="text-gray-400 text-sm">
                  SAIF's Spec Designer scans your repo, learns your unique patterns, and outputs a
                  production-ready architectural spec.
                </p>
              </div>
            </div>

            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[#333] bg-[#0F0F0F] text-gray-400 font-mono font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                3
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-xl border border-[#333] bg-[#111]">
                <h3 className="font-bold text-white mb-1">The Iron Contract</h3>
                <p className="text-gray-400 text-sm">
                  SAIF generates rock-solid TDD tests against the spec. This is the unyielding wall.
                </p>
              </div>
            </div>

            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[#333] bg-[#0F0F0F] text-gray-400 font-mono font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                4
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-xl border border-[#333] bg-[#111]">
                <h3 className="font-bold text-white mb-1">Unleash the Swarm</h3>
                <p className="text-gray-400 text-sm">
                  Hit{' '}
                  <code className="text-[#00FF66] bg-[#00FF66]/10 px-1 rounded">saif feat run</code>
                  . The agent codes, the test runner grades. It fails, it learns, it fixes. They
                  loop until green.
                </p>
              </div>
            </div>

            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[#00FF66] bg-[#00FF66]/10 text-[#00FF66] font-mono font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                <CheckIcon />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-xl border border-[#00FF66]/30 bg-[#00FF66]/5 shadow-[0_0_15px_rgba(0,255,102,0.05)]">
                <h3 className="font-bold text-white mb-1">You Merge</h3>
                <p className="text-gray-300 text-sm">
                  You come back to a pristine PR. Features shipped in minutes, not sprints.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Batteries Included */}
        <section className="bg-[#111] border-y border-[#333] py-24 mb-32">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-white mb-4">
                Batteries-Included Infrastructure
              </h2>
              <p className="text-gray-400">
                Plugs straight into the stack you already use. No vendor lock-in.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 border border-[#333] bg-[#0F0F0F] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                <span className="text-3xl font-bold text-white">21</span>
                <span className="text-sm text-gray-400 font-mono">LLM Providers</span>
              </div>
              <div className="p-4 border border-[#333] bg-[#0F0F0F] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                <span className="text-3xl font-bold text-white">14</span>
                <span className="text-sm text-gray-400 font-mono">Agentic CLIs</span>
              </div>
              <div className="p-4 border border-[#333] bg-[#0F0F0F] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                <span className="text-3xl font-bold text-white">4</span>
                <span className="text-sm text-gray-400 font-mono">
                  Languages (Node, Py, Go, Rs)
                </span>
              </div>
              <div className="p-4 border border-[#333] bg-[#0F0F0F] rounded-lg text-center flex flex-col items-center justify-center gap-2">
                <span className="text-3xl font-bold text-white">5</span>
                <span className="text-sm text-gray-400 font-mono">Git Providers</span>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Sponsorship & Built by Solo */}
        <section id="sponsor" className="max-w-4xl mx-auto px-6 mb-32">
          <div className="p-10 rounded-2xl border border-[#333] bg-gradient-to-br from-[#111] to-[#0F0F0F] text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00FF66] opacity-5 blur-[100px] rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500 opacity-5 blur-[100px] rounded-full"></div>

            <Lock className="w-10 h-10 text-gray-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-4">
              Built by a Solo Dev. Fuel the Revolution.
            </h2>
            <p className="text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
              SAIF is built entirely by a single developer working nights and weekends. No corporate
              bureaucracy, just rapid iteration to bring the agentic revolution to everyone.
            </p>
            <p className="text-gray-300 font-medium mb-8">
              If SAIF saves your engineering team thousands of hours and dollars,
              <br /> please consider sponsoring the project to ensure its continued development.
            </p>

            <a
              href="https://github.com/sponsors/JuroOravec"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#1A1A1A] hover:bg-[#222] border border-[#333] hover:border-[#00FF66] text-white rounded-md transition-all"
            >
              <span className="text-pink-500">♥</span> Sponsor on GitHub
            </a>
          </div>
        </section>

        {/* 7. Final CTA */}
        <section className="text-center max-w-2xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-white mb-6">The era of babysitting AI is over.</h2>
          <p className="text-xl text-gray-400 mb-10">
            Are you building the factory, or competing against teams that already are?
          </p>
          <div className="inline-flex items-center gap-4 p-2 bg-[#1A1A1A] border border-[#333] rounded-lg">
            <code className="px-4 py-2 font-mono text-[#00FF66] bg-black/50 rounded">
              npm install -g safe-ai-factory
            </code>
            <a
              href="https://github.com/JuroOravec/safe-ai-factory/blob/main/docs/usage.md"
              className="px-4 py-2 bg-white text-black font-medium rounded hover:bg-gray-200 transition-colors"
            >
              Read the Docs
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#333] py-8 text-center text-sm text-gray-500 font-mono">
        <p>safe-ai-factory © {new Date().getFullYear()} • MIT License</p>
      </footer>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}
