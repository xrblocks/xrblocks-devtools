import {describe, expect, it, vi} from 'vitest';
import type {XRBlocksSession} from '../../src/session/session.js';
import {
  agentActionDeclarations,
  agentActionPrompt,
  executeAgentAction,
} from '../../src/session/actions.js';

describe('agent action interface', () => {
  it('routes text audio and tagged targets through Session', async () => {
    const injectAudio = vi.fn();
    const lookAtTarget = vi.fn();
    const session = {injectAudio, lookAtTarget} as unknown as XRBlocksSession;

    await executeAgentAction(session, 'primitive', 'say', {
      text: 'open the menu',
    });
    await executeAgentAction(session, 'targeted', 'look_at_target', {
      target: {tag: 'submit'},
    });

    expect(injectAudio).toHaveBeenCalledWith({text: 'open the menu'});
    expect(lookAtTarget).toHaveBeenCalledWith(
      {tag: 'submit'},
      {speedDegreesPerSecond: 720}
    );
  });

  it('publishes and enforces movement bounds', () => {
    const declarations = agentActionDeclarations('targeted');
    const look = declarations.find(({name}) => name === 'look_at_target');
    const reach = declarations.find(({name}) => name === 'reach_to_target');

    expect(look?.parameters.properties.speed_degrees_per_second).toMatchObject({
      minimum: 5,
      maximum: 3600,
    });
    expect(reach?.parameters.properties.speed_meters_per_second).toMatchObject({
      minimum: 0.05,
      maximum: 20,
    });
    expect(() =>
      executeAgentAction({} as XRBlocksSession, 'targeted', 'look_at_target', {
        target: 'Target',
        speed_degrees_per_second: 3601,
      })
    ).toThrow('between 5 and 3600 degrees per second');
  });

  it('keeps low-level frame and control operations outside the model tools', () => {
    const names = agentActionDeclarations('targeted').map(({name}) => name);
    expect(names).not.toContain('step_frame');
    expect(names).not.toContain('step_control');
    expect(names).not.toContain('apply_control');
  });

  it('provides coherent primitive and targeted tool profiles', () => {
    const primitive = agentActionDeclarations('primitive').map(
      ({name}) => name
    );
    const targeted = agentActionDeclarations('targeted').map(({name}) => name);

    expect(primitive).toEqual([
      'say',
      'move',
      'rotate',
      'move_hand',
      'rotate_hand',
      'gesture',
      'start_select',
      'end_select',
      'wait',
    ]);
    expect(agentActionDeclarations('primitive')[0]?.parameters).toMatchObject({
      type: 'object',
      properties: {text: {type: 'string'}},
    });
    expect(targeted).toEqual([
      ...primitive,
      'look_at_target',
      'point_to_target',
      'reach_to_target',
      'click',
    ]);

    expect(agentActionPrompt('primitive')).toContain(
      'wait advances the app without moving the user'
    );
    expect(agentActionPrompt('primitive')).not.toContain('look_at_target');
    expect(agentActionPrompt('targeted')).toContain('look_at_target');
  });

  it('rejects execution outside the selected profile', () => {
    expect(() =>
      executeAgentAction({} as XRBlocksSession, 'primitive', 'look_at_target', {
        target: 'Target',
      })
    ).toThrow(
      'Autonomous runner tool look_at_target is not available in the primitive profile.'
    );
  });

  it('waits within the declared bound', async () => {
    const wait = vi.fn();
    const session = {wait} as unknown as XRBlocksSession;
    const declaration = agentActionDeclarations('primitive').find(
      ({name}) => name === 'wait'
    );

    expect(declaration?.parameters.properties.duration_ms).toMatchObject({
      minimum: 50,
      maximum: 2_000,
    });
    await executeAgentAction(session, 'primitive', 'wait', {
      duration_ms: 2_000,
    });
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(() =>
      executeAgentAction(session, 'primitive', 'wait', {duration_ms: 49})
    ).toThrow('duration_ms must be an integer between 50 and 2000.');
    expect(() =>
      executeAgentAction(session, 'primitive', 'wait', {duration_ms: 2_001})
    ).toThrow('duration_ms must be an integer between 50 and 2000.');
  });
});
