'use client';

import { useState } from 'react';

interface FeedbackModalProps {
  videoGenerationId: number;
  videoProjectId?: number;
  /** Called after feedback is successfully submitted */
  onClose: () => void;
}

interface RatingField {
  key: keyof Ratings;
  label: string;
}

interface Ratings {
  hookQuality: number | null;
  voiceDelivery: number | null;
  speakingPace: number | null;
  energyExpressions: number | null;
  gesturesActions: number | null;
  visualConsistency: number | null;
  overallQuality: number | null;
}

const RATING_FIELDS: RatingField[] = [
  { key: 'hookQuality',       label: 'Hook quality' },
  { key: 'voiceDelivery',     label: 'Voice delivery' },
  { key: 'speakingPace',      label: 'Speaking pace' },
  { key: 'energyExpressions', label: 'Energy & expressions' },
  { key: 'gesturesActions',   label: 'Gestures & actions' },
  { key: 'visualConsistency', label: 'Visual consistency' },
  { key: 'overallQuality',    label: 'Overall quality' },
];

const EMPTY_RATINGS: Ratings = {
  hookQuality: null,
  voiceDelivery: null,
  speakingPace: null,
  energyExpressions: null,
  gesturesActions: null,
  visualConsistency: null,
  overallQuality: null,
};

export default function FeedbackModal({ videoGenerationId, videoProjectId, onClose }: FeedbackModalProps) {
  const [ratings, setRatings] = useState<Ratings>(EMPTY_RATINGS);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function setRating(key: keyof Ratings, value: number) {
    setRatings((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/v1/generation-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoGenerationId,
          ...ratings,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Submission failed');
      }

      // Fire-and-forget analytics event
      void fetch('/api/v1/analytics-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'feedback_submitted',
          videoProjectId: videoProjectId ?? null,
          payload: { videoGenerationId, hasNotes: notes.trim().length > 0 },
        }),
      });

      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <div>
            <div className="card-title">Rate this generation</div>
            <div className="card-subtitle">Your feedback helps improve future prompts.</div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ fontSize: 20, lineHeight: 1, padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {RATING_FIELDS.map(({ key, label }) => (
              <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{label}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(key, star)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 6,
                        border: '1px solid',
                        borderColor: ratings[key] === star ? 'var(--brand)' : 'var(--border)',
                        background: ratings[key] != null && star <= ratings[key]
                          ? 'var(--brand)'
                          : 'var(--surface)',
                        color: ratings[key] != null && star <= ratings[key]
                          ? '#fff'
                          : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                        transition: 'all 0.1s',
                      }}
                    >
                      {star}
                    </button>
                  ))}
                  {ratings[key] != null && (
                    <button
                      type="button"
                      onClick={() => setRatings((prev) => ({ ...prev, [key]: null }))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: '0 4px',
                      }}
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Notes (optional)</label>
              <textarea
                className="form-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any specific observations about this clip…"
              />
            </div>

            {error && (
              <div className="alert alert-error" style={{ fontSize: 13 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit feedback'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
