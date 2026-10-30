import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, inputClass, Page, Pill } from "@/components/studio/bits";
import {
  analyticsBrief,
  commitAnalysis,
  concludeExperiment,
  correctInterpretation,
  handEvidenceToBrain,
  importObservation,
  proposeExperiment,
} from "@/lib/studio/analytics";
import { reviewer, useStudio } from "@/lib/studio/store";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

function AnalyticsPage() {
  const db = useStudio((s) => s.db);
  const apply = useStudio((s) => s.apply);
  const actor = reviewer(db);
  const brief = analyticsBrief(db);
  const [title, setTitle] = useState("Hypothetical lane episode");
  const [structure, setStructure] = useState("help-a-friend");
  const [characters, setCharacters] = useState("Meethi, Golu");
  const [retention, setRetention] = useState("62");
  const [views, setViews] = useState("");
  const [hypothesis, setHypothesis] = useState("A single clear problem may hold attention better than two problems.");
  const [result, setResult] = useState("Not enough episodes yet to separate the groups.");
  const openFindings = (db.analyticsInterpretations ?? []).filter((item) => item.status === "OPEN").slice(0, 3);
  const packet = (db.analyticsPackets ?? []).find((item) => !item.handedToBrain && !item.stale);

  function recordSample() {
    const retentionValue = retention.trim() === "" ? null : Number(retention);
    const viewsValue = views.trim() === "" ? null : Number(views);
    apply(
      importObservation(
        db,
        {
          episodeId: `sample_manual_${db.seq + 1}`,
          title: title.trim() || "Hypothetical sample",
          hypothetical: true,
          source: "hypothetical",
          provider: "manual",
          format: "long-form",
          language: "hi",
          runtimeSeconds: 360,
          locationKey: "gulmohar-gali",
          worldKey: "gulmohar-gali",
          characterNames: characters.split(",").map((name) => name.trim()).filter(Boolean),
          storyStructure: structure.trim() || null,
          targetAge: db.studio?.ageBand ?? "3-5",
          songUsage: "none",
          episodeVersion: 1,
          metrics: { retention: retentionValue, views: viewsValue, completion: null },
          note: "Manual hypothetical sample. Not a live platform export.",
        },
        actor,
      ),
    );
  }

  return (
    <Page
      kicker="Analytics"
      title="What happened?"
      lede="Measurements, comparisons, and lessons. Analytics does not approve work, clear rights, or publish. There is no live audience connection."
    >
      <Card>
        <h2 className="text-xl">Overview</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="marigold">{brief.overview.evidenceState.replaceAll("_", " ")}</Pill>
          <Pill tone="quiet">Confidence {brief.overview.confidence}</Pill>
          <Pill tone="quiet">Published {brief.overview.publishedEpisodes}</Pill>
          <Pill tone="quiet">Sample n={brief.overview.sampleSize}</Pill>
          <Pill tone="clay">Live connection off</Pill>
        </div>
        <p className="mt-3 text-sm">{brief.happened}</p>
        <p className="mt-2 text-sm text-muted">
          Views {brief.overview.totalViews == null ? "unknown" : brief.overview.totalViews}. Watch time {brief.overview.totalWatchTime == null ? "unknown" : brief.overview.totalWatchTime}. Live retention {brief.overview.averageRetention == null ? "unknown" : brief.overview.averageRetention}. Missing numbers stay unknown. They are not stored as zero.
        </p>
        <p className="mt-2 text-sm text-muted">Aggregated platform metrics only. No child profiles, names, or private messages.</p>
      </Card>
      <Card>
        <h2 className="text-xl">Episodes</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {brief.episodes.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{item.title}</span>
                <Pill tone={item.dataState === "NOT_AVAILABLE" ? "clay" : "quiet"}>{item.dataState.replaceAll("_", " ")}</Pill>
              </div>
              <p className="text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
        {(db.analyticsObservations ?? []).length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            {db.analyticsObservations.map((row) => (
              <li key={row.id} className="border-t border-line pt-2">
                <p className="font-semibold">{row.title}</p>
                <p className="text-muted">
                  {row.hypothetical ? "Hypothetical. " : "Reported. "}
                  Version {row.episodeVersion ?? "unknown"}. Retention {row.metrics.retention ?? "unknown"}. Views {row.metrics.views ?? "unknown"}. {row.rankable ? "In the sample." : "Excluded from rankings."}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No measurement is stored. Unpublished episodes are not given a score.</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Hypothetical title">
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Story structure">
            <input className={inputClass} value={structure} onChange={(event) => setStructure(event.target.value)} />
          </Field>
          <Field label="Characters">
            <input className={inputClass} value={characters} onChange={(event) => setCharacters(event.target.value)} />
          </Field>
          <Field label="Retention, if known">
            <input className={inputClass} inputMode="decimal" value={retention} onChange={(event) => setRetention(event.target.value)} />
          </Field>
          <Field label="Views, leave blank if unknown">
            <input className={inputClass} inputMode="numeric" value={views} onChange={(event) => setViews(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={recordSample}>Store hypothetical sample</Button>
          <Button type="button" variant="quiet" onClick={() => apply(commitAnalysis(db, actor))}>Read the sample</Button>
        </div>
        <p className="mt-2 text-xs text-muted">A hypothetical sample is not live audience data. Count the Thunder cannot be given numbers here.</p>
      </Card>
      <Card>
        <h2 className="text-xl">Patterns</h2>
        {brief.patterns.length === 0 ? <p className="mt-2 text-sm text-muted">No pattern is claimed. A small sample stays an early signal.</p> : null}
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {brief.patterns.map((item) => (
            <li key={item} className="border-t border-line pt-2">{item}</li>
          ))}
        </ul>
        {brief.locations.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {brief.locations.map((place) => (
              <li key={place.key}>{place.key}: n={place.sampleSize}, retention {place.medianRetention ?? "unknown"}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No approved place has audience rankings. Proposed places stay out.</p>
        )}
      </Card>
      <Card>
        <h2 className="text-xl">Experiments</h2>
        {brief.experiments.length === 0 ? <p className="mt-2 text-sm text-muted">No experiment is open. An empty result is not support.</p> : null}
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {db.analyticsExperiments.map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <div className="flex flex-wrap gap-2">
                <Pill tone="quiet">{item.status}</Pill>
                {item.conclusion ? <Pill tone={item.conclusion === "not_supported" ? "clay" : "marigold"}>{item.conclusion.replaceAll("_", " ")}</Pill> : null}
              </div>
              <p className="mt-1 font-semibold">{item.hypothesis}</p>
              <p className="text-muted">{item.result ?? item.baselineNote}</p>
              {item.status === "PROPOSED" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="quiet" onClick={() => apply(concludeExperiment(db, item.id, "supported", result, actor))}>Supported</Button>
                  <Button type="button" variant="quiet" onClick={() => apply(concludeExperiment(db, item.id, "not_supported", result, actor))}>Not supported</Button>
                  <Button type="button" variant="quiet" onClick={() => apply(concludeExperiment(db, item.id, "inconclusive", result, actor))}>Inconclusive</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3">
          <Field label="Hypothesis">
            <textarea className={inputClass} rows={2} value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} />
          </Field>
          <Field label="Result note, used when you conclude">
            <textarea className={inputClass} rows={2} value={result} onChange={(event) => setResult(event.target.value)} />
          </Field>
        </div>
        <Button className="mt-3" type="button" variant="quiet" onClick={() => apply(proposeExperiment(db, { hypothesis, targetAge: db.studio?.ageBand ?? "3-5" }, actor))}>
          Propose experiment
        </Button>
      </Card>
      <Card>
        <h2 className="text-xl">Anomalies</h2>
        {brief.anomalies.length === 0 ? <p className="mt-2 text-sm text-muted">No anomaly is flagged. A spike would ask for investigation, not a copy.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {brief.anomalies.map((item) => (
            <li key={item} className="border-t border-line pt-2">{item}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl">Lessons</h2>
        {brief.lessons.length === 0 ? <p className="mt-2 text-sm text-muted">The learning library is empty. Lessons are reviewed, not treated as permanent rules.</p> : null}
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {(db.analyticsLessons ?? []).map((item) => (
            <li key={item.id} className="border-t border-line pt-2">
              <div className="flex flex-wrap gap-2">
                <Pill tone={item.negative ? "clay" : "quiet"}>{item.status}{item.negative ? " · negative" : ""}</Pill>
                <Pill tone="quiet">{item.confidence}</Pill>
                <Pill tone="quiet">n={item.sampleSize}</Pill>
              </div>
              <p className="mt-1">{item.observation}</p>
              <p className="text-muted">{item.recommendation}</p>
            </li>
          ))}
        </ul>
        {openFindings.map((item) => (
          <div key={item.id} className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="quiet" onClick={() => apply(correctInterpretation(db, item.id, "MISLEADING", "Context makes this reading easy to misuse.", actor))}>Mark “{item.title}” misleading</Button>
            <Button type="button" variant="quiet" onClick={() => apply(correctInterpretation(db, item.id, "NEEDS_MORE_DATA", "The sample is too small to keep this reading.", actor))}>“{item.title}” needs more data</Button>
          </div>
        ))}
      </Card>
      <Card>
        <h2 className="text-xl">Data quality</h2>
        {brief.quality.length === 0 ? <p className="mt-2 text-sm text-muted">No data-quality issue is stored.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {brief.quality.map((item) => (
            <li key={item} className="border-t border-line pt-2 text-clay">{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">Bad values stay as imported. A correction is stored beside them.</p>
      </Card>
      <Card>
        <h2 className="text-xl">What should we investigate?</h2>
        {brief.investigate.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing to hand to the studio brain.</p> : null}
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {brief.investigate.map((item) => (
            <li key={item} className="border-t border-line pt-2">{item}</li>
          ))}
        </ul>
        {brief.uncertain[0] ? <p className="mt-3 text-sm text-muted">Uncertain: {brief.uncertain[0]}</p> : null}
        <Button className="mt-3" type="button" disabled={!packet} onClick={() => packet && apply(handEvidenceToBrain(db, packet.id, actor))}>
          Send evidence to the studio brain
        </Button>
        <p className="mt-2 text-xs text-muted">The brain can recommend an investigation. A human still decides. The production queue does not move.</p>
      </Card>
    </Page>
  );
}
