import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function SchedulerPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Scheduler</h1>
      <p className="text-lg text-gray-600 mb-8">Coming soon</p>
      <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium">
        <ArrowRight className="w-4 h-4 mr-2 rotate-180" />
        Back to Home
      </Link>
    </div>
  );
}
