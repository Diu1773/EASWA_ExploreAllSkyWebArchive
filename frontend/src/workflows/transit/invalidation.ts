import type { TransitWorkflowStep } from './definition';

export interface TransitInvalidationState {
  step: TransitWorkflowStep;
  hasPhotometryResult: boolean;
}

export type TransitInvalidationAction =
  | { type: 'observation-changed' }
  | { type: 'analysis-config-changed' }
  | { type: 'hard-reset' };

export interface TransitInvalidationResolution {
  cancelPreviewJobs: boolean;
  abortPhotometryRun: boolean;
  clearPreviewRuntime: boolean;
  clearPhotometryProgress: boolean;
  clearPhotometryResult: boolean;
  clearFitState: boolean;
  clearSelectionState: boolean;
  clearWindowSelection: boolean;
  clearSubmittedRecord: boolean;
  resetRecordDraft: boolean;
  clearSeedRecordSummary: boolean;
  resetCutoutSetup: boolean;
  resetTargetAperture: boolean;
  clearErrorMessage: boolean;
  nextStep: TransitWorkflowStep | null;
}

const ANALYSIS_RESULT_STEPS = new Set<TransitWorkflowStep>([
  'comparisonqc',
  'lightcurve',
  'transitfit',
  'record',
]);

export function reduceTransitInvalidation(
  state: TransitInvalidationState,
  action: TransitInvalidationAction
): TransitInvalidationResolution {
  switch (action.type) {
    case 'observation-changed':
      return {
        cancelPreviewJobs: true,
        abortPhotometryRun: true,
        clearPreviewRuntime: true,
        clearPhotometryProgress: true,
        clearPhotometryResult: true,
        clearFitState: true,
        clearSelectionState: true,
        clearWindowSelection: true,
        clearSubmittedRecord: true,
        resetRecordDraft: true,
        clearSeedRecordSummary: false,
        resetCutoutSetup: false,
        resetTargetAperture: false,
        clearErrorMessage: true,
        nextStep: state.step === 'select' ? null : 'select',
      };
    case 'analysis-config-changed':
      return {
        cancelPreviewJobs: false,
        abortPhotometryRun: false,
        clearPreviewRuntime: false,
        clearPhotometryProgress: true,
        clearPhotometryResult: state.hasPhotometryResult,
        clearFitState: true,
        clearSelectionState: false,
        clearWindowSelection: false,
        clearSubmittedRecord: true,
        resetRecordDraft: false,
        clearSeedRecordSummary: false,
        resetCutoutSetup: false,
        resetTargetAperture: false,
        clearErrorMessage: false,
        nextStep:
          state.hasPhotometryResult && ANALYSIS_RESULT_STEPS.has(state.step) ? 'run' : null,
      };
    case 'hard-reset':
      return {
        cancelPreviewJobs: true,
        abortPhotometryRun: true,
        clearPreviewRuntime: true,
        clearPhotometryProgress: true,
        clearPhotometryResult: true,
        clearFitState: true,
        clearSelectionState: true,
        clearWindowSelection: true,
        clearSubmittedRecord: true,
        resetRecordDraft: true,
        clearSeedRecordSummary: true,
        resetCutoutSetup: true,
        resetTargetAperture: true,
        clearErrorMessage: true,
        nextStep: 'select',
      };
  }
}
