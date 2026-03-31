'use client';

import { useState } from 'react';
import { ProductionUploader } from '@/components/upload/ProductionUploader';
import { useProductionUpload } from '@/hooks/useProductionUpload';

/**
 * TEST PAGE FOR PRODUCTION UPLOADER
 * 
 * Add this to your app and visit it to test the uploader:
 * - http://localhost:3000/test/upload (if using app router)
 * 
 * Tests to perform:
 * 1. Drag and drop files
 * 2. Click "Add Files" and select multiple files
 * 3. Watch parallel uploads (should show 3 at a time)
 * 4. Pause an upload, resume it
 * 5. Cancel an upload
 * 6. Watch automatic retry on network error
 * 7. Check speed and ETA calculations
 */

export default function UploadTestPage() {
  const { tasks, stats, addFiles, pauseTask, resumeTask, cancelTask, retryTask } =
    useProductionUpload({
      maxConcurrent: 3,
      maxRetries: 3,
    });

  const [showStats, setShowStats] = useState(true);
  const [showTasks, setShowTasks] = useState(true);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            📤 Production Uploader Test
          </h1>
          <p className="text-gray-600">
            Test parallel uploads, pause/resume, and error handling
          </p>
        </div>

        {/* Stats Panel */}
        {showStats && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">📊 Upload Statistics</h2>
              <button
                onClick={() => setShowStats(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded p-3">
                <p className="text-sm text-gray-600">Total Files</p>
                <p className="text-2xl font-bold text-blue-600">{stats.totalFiles}</p>
              </div>
              <div className="bg-purple-50 rounded p-3">
                <p className="text-sm text-gray-600">Uploading</p>
                <p className="text-2xl font-bold text-purple-600">{stats.uploading}</p>
              </div>
              <div className="bg-green-50 rounded p-3">
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              </div>
              <div className="bg-red-50 rounded p-3">
                <p className="text-sm text-gray-600">Failed</p>
                <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">Overall Progress</p>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${stats.overallProgress}%` }}
                  />
                </div>
                <p className="text-sm font-semibold text-gray-900 mt-1">
                  {stats.overallProgress}%
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-2">Data Transferred</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatBytes(stats.uploadedBytes)} / {formatBytes(stats.totalBytes)}
                </p>
                {stats.avgSpeed > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    Avg Speed: {(stats.avgSpeed / (1024 * 1024)).toFixed(1)} MB/s
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Task List */}
        {showTasks && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                📋 Upload Tasks ({tasks.length})
              </h2>
              <button
                onClick={() => setShowTasks(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>

            {tasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No uploads yet. Use the uploader panel on the right →
              </p>
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 truncate">{task.name}</p>
                        <p className="text-sm text-gray-500">
                          {formatBytes(task.size)} • {task.status}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {task.status === 'uploading' && (
                          <button
                            onClick={() => pauseTask(task.id)}
                            className="px-3 py-1 text-sm bg-amber-100 text-amber-900 rounded hover:bg-amber-200"
                          >
                            Pause
                          </button>
                        )}
                        {task.status === 'paused' && (
                          <button
                            onClick={() => resumeTask(task.id)}
                            className="px-3 py-1 text-sm bg-blue-100 text-blue-900 rounded hover:bg-blue-200"
                          >
                            Resume
                          </button>
                        )}
                        {task.status === 'failed' && (
                          <button
                            onClick={() => retryTask(task.id)}
                            className="px-3 py-1 text-sm bg-orange-100 text-orange-900 rounded hover:bg-orange-200"
                          >
                            Retry
                          </button>
                        )}
                        {(task.status === 'uploading' || task.status === 'paused' || task.status === 'queued') && (
                          <button
                            onClick={() => cancelTask(task.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-900 rounded hover:bg-red-200"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {task.status !== 'completed' && task.status !== 'cancelled' && (
                      <div className="mb-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Progress Details */}
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>{task.progress}%</span>
                      {task.status === 'uploading' && task.speedBps > 0 && (
                        <>
                          <span>
                            {(task.speedBps / (1024 * 1024)).toFixed(1)} MB/s
                          </span>
                          <span>
                            {Math.floor(task.etaSeconds / 60)}m{' '}
                            {task.etaSeconds % 60}s remaining
                          </span>
                        </>
                      )}
                    </div>

                    {/* Error Message */}
                    {task.error && (
                      <p className="text-xs text-red-600 mt-2">Error: {task.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info Panel */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">ℹ️ Test Instructions</h2>
          <ul className="space-y-2 text-gray-700">
            <li>✓ <strong>Drag & Drop:</strong> Use the uploader panel to drag files</li>
            <li>✓ <strong>Parallel Uploads:</strong> Upload multiple files to see 3 uploading at once</li>
            <li>✓ <strong>Pause/Resume:</strong> Click the Pause button during upload, then Resume</li>
            <li>✓ <strong>Cancel:</strong> Stop an upload with the Cancel button</li>
            <li>✓ <strong>Retry:</strong> Failed uploads can be manually retried</li>
            <li>✓ <strong>Auto-Retry:</strong> Network errors trigger automatic retry after 2 seconds</li>
            <li>✓ <strong>Monitor Progress:</strong> Watch the speed and ETA update in real-time</li>
          </ul>
        </div>
      </div>

      {/* The Uploader Component */}
      <ProductionUploader
        onFilesAdded={(count) => {
          console.log(`${count} files added to upload queue`);
        }}
      />
    </div>
  );
}
