import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | SAIFAC',
  description: 'Privacy Policy for Safe AI Factory (SAIFAC).',
};

function getPolicyHtml(): string {
  const filePath = path.join(process.cwd(), 'src', 'content', 'policy.html');
  return readFileSync(filePath, 'utf-8');
}

export default function PrivacyPage() {
  const policyHtml = getPolicyHtml();

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-gray-200 selection:bg-[#00FF66] selection:text-black">
      {/* Minimal header */}
      <header className="fixed top-0 w-full z-50 border-b border-[#333] bg-[#0F0F0F]/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <img src="/saifac-icon-green.svg" alt="SAIFAC" className="w-6 h-6 shrink-0" />
            <span className="font-mono font-bold tracking-tight text-white">SAIFAC</span>
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Back
          </Link>
        </div>
      </header>

      {/* Policy content - dark theme overrides for Termly styles */}
      <main className="pt-24 pb-16 px-6">
        <article
          className="max-w-3xl mx-auto privacy-policy prose prose-invert prose-headings:text-white prose-p:text-gray-400 prose-a:text-[#00FF66] prose-a:no-underline hover:prose-a:underline"
          dangerouslySetInnerHTML={{ __html: policyHtml }}
        />
      </main>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .privacy-policy [data-custom-class='body_text'],
          .privacy-policy [data-custom-class='body_text'] * {
            color: #9ca3af !important;
          }
          .privacy-policy [data-custom-class='title'],
          .privacy-policy [data-custom-class='title'] * {
            color: #fff !important;
          }
          .privacy-policy [data-custom-class='subtitle'],
          .privacy-policy [data-custom-class='subtitle'] * {
            color: #6b7280 !important;
          }
          .privacy-policy [data-custom-class='heading_1'],
          .privacy-policy [data-custom-class='heading_1'] * {
            color: #fff !important;
          }
          .privacy-policy [data-custom-class='heading_2'],
          .privacy-policy [data-custom-class='heading_2'] * {
            color: #e5e7eb !important;
          }
          .privacy-policy [data-custom-class='link'],
          .privacy-policy [data-custom-class='link'] * {
            color: #00ff66 !important;
          }
          .privacy-policy span[style*="color: rgb(89, 89, 89)"] {
            color: #9ca3af !important;
          }
          .privacy-policy a[href^="mailto:"] {
            color: #00ff66 !important;
          }
        `,
        }}
      />
    </div>
  );
}
