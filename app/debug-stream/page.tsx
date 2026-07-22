import { StreamDebugger } from "@/components/StreamDebugger";

export default function DebugStreamPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold mb-8 text-center">Stream Debug Tool</h1>
        <StreamDebugger />
      </div>
    </div>
  );
}
