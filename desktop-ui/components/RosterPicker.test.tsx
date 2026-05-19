import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/api/client", () => ({
  Agents: { list: vi.fn() },
  Teams: { list: vi.fn(), get: vi.fn(), saveAdhoc: vi.fn() },
}));

import { Agents, Teams } from "@/api/client";
import { useAppStore } from "@/stores/appStore";

import { RosterPicker } from "./RosterPicker";

const RESET_STATE = useAppStore.getState();

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
  );
}

const AGENTS = [
  {
    id: "a-researcher",
    name: "Researcher",
    description: "Finds and synthesises information.",
    role: "coordinator",
  },
  {
    id: "a-builder",
    name: "Builder",
    description: "Writes code and runs tools.",
    role: "worker",
  },
  {
    id: "a-critic",
    name: "Critic",
    description: "Reviews and pushes back.",
    role: "worker",
  },
];

const TEAMS = [
  {
    id: "t-research-squad",
    name: "Research Squad",
    description: "Two-agent research stack",
    coordinator_id: "a-researcher",
    is_adhoc: 0,
  },
];

function checked(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("aria-checked");
}

beforeEach(() => {
  useAppStore.setState(
    { sidecarStatus: { status: "ready" }, toasts: [] } as never,
    false,
  );
  vi.mocked(Agents.list).mockReset();
  vi.mocked(Agents.list).mockResolvedValue(AGENTS as never);
  vi.mocked(Teams.list).mockReset();
  vi.mocked(Teams.list).mockResolvedValue(TEAMS as never);
  vi.mocked(Teams.get).mockReset();
  vi.mocked(Teams.get).mockResolvedValue({
    members: [{ id: "a-researcher" }, { id: "a-builder" }],
  } as never);
  vi.mocked(Teams.saveAdhoc).mockReset();
});

afterEach(() => {
  cleanup();
  useAppStore.setState(RESET_STATE, true);
});

describe("RosterPicker — pill trigger", () => {
  it("shows 'No agent' when nothing is bound", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    const pill = await screen.findByTestId("roster-picker-pill");
    expect(pill.textContent).toContain("No agent");
  });

  it("shows the active agent's name when an agent is bound", async () => {
    render(
      wrap(
        <RosterPicker agentId="a-builder" teamId="" onApply={vi.fn()} />,
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("roster-picker-pill").textContent,
      ).toContain("Builder");
    });
  });

  it("opens the composer dropdown when the pill is clicked", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    expect(screen.getByTestId("roster-picker-dropdown")).toBeTruthy();
  });

  it("is disabled until the sidecar is ready", () => {
    useAppStore.setState(
      { sidecarStatus: { status: "starting" } } as never,
      false,
    );
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    const pill = screen.getByTestId("roster-picker-pill") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
  });
});

describe("RosterPicker — chip-card grid", () => {
  it("renders a chip card per agent plus a 'No agent' fallback card", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));

    await screen.findByTestId("roster-picker-agent-none");
    for (const a of AGENTS) {
      expect(
        screen.getByTestId(`roster-picker-agent-${a.id}`),
      ).toBeTruthy();
    }
  });

  it("highlights the active agent's chip card as selected when the picker opens", async () => {
    render(
      wrap(
        <RosterPicker agentId="a-builder" teamId="" onApply={vi.fn()} />,
      ),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    await waitFor(() => {
      expect(checked("roster-picker-agent-a-builder")).toBe("true");
    });
    // The 'No agent' pseudo-card is deselected when an agent is bound.
    expect(checked("roster-picker-agent-none")).toBe("false");
  });

  it("toggles an agent on/off when its card is clicked", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    const card = await screen.findByTestId("roster-picker-agent-a-builder");
    expect(card.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(card);
    expect(card.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(card);
    expect(card.getAttribute("aria-checked")).toBe("false");
  });

  it("filters chip cards by the search box (name, role, or description)", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    const search = await screen.findByTestId("roster-picker-search");
    fireEvent.change(search, { target: { value: "critic" } });
    await waitFor(() => {
      expect(screen.getByTestId("roster-picker-agent-a-critic")).toBeTruthy();
      expect(
        screen.queryByTestId("roster-picker-agent-a-builder"),
      ).toBeNull();
    });
  });
});

describe("RosterPicker — coordinator auto-pick", () => {
  it("does not show a coordinator badge when only one agent is selected", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-builder"),
    );
    expect(screen.queryByTestId("roster-picker-coordinator-badge")).toBeNull();
  });

  it("flags the agent with role=coordinator when 2+ agents are selected", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-builder"),
    );
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-researcher"),
    );
    // The researcher has role="coordinator" — it should carry the badge,
    // even though it was added second.
    const researcherCard = screen.getByTestId(
      "roster-picker-agent-a-researcher",
    );
    expect(
      within(researcherCard).getByTestId("roster-picker-coordinator-badge"),
    ).toBeTruthy();
    // The summary line mirrors the badge.
    expect(
      screen.getByTestId("roster-picker-summary").textContent,
    ).toContain("Coordinator: Researcher");
  });

  it("falls back to the first selected agent (by registry order) when no agent has role=coordinator", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-builder"),
    );
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-critic"),
    );
    // No coordinator role in this set → first agent in registry order
    // among the drafted set (a-builder comes before a-critic).
    const builderCard = screen.getByTestId("roster-picker-agent-a-builder");
    expect(
      within(builderCard).getByTestId("roster-picker-coordinator-badge"),
    ).toBeTruthy();
  });
});

describe("RosterPicker — saved-team chips", () => {
  it("renders a chip per saved (non-adhoc) team", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    expect(
      await screen.findByTestId("roster-picker-team-t-research-squad"),
    ).toBeTruthy();
  });

  it("hides ad-hoc teams from the saved-team chip strip", async () => {
    vi.mocked(Teams.list).mockResolvedValue([
      ...TEAMS,
      {
        id: "t-adhoc-42",
        name: "ad-hoc",
        coordinator_id: "a-builder",
        is_adhoc: 1,
      },
    ] as never);
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    await screen.findByTestId("roster-picker-team-t-research-squad");
    expect(screen.queryByTestId("roster-picker-team-t-adhoc-42")).toBeNull();
  });

  it("picking a saved team hydrates the draft from its members and surfaces its stored coordinator", async () => {
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={vi.fn()} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-team-t-research-squad"),
    );
    await waitFor(() => {
      expect(checked("roster-picker-agent-a-researcher")).toBe("true");
      expect(checked("roster-picker-agent-a-builder")).toBe("true");
    });
    // Researcher is the team's stored coordinator_id, so it gets the badge.
    const researcherCard = screen.getByTestId(
      "roster-picker-agent-a-researcher",
    );
    expect(
      within(researcherCard).getByTestId("roster-picker-coordinator-badge"),
    ).toBeTruthy();
  });
});

describe("RosterPicker — apply", () => {
  it("dispatches a solo onApply when exactly one agent is selected", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={onApply} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-builder"),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("roster-picker-apply"));
    });
    expect(onApply).toHaveBeenCalledWith({ agentIds: ["a-builder"] });
  });

  it("dispatches an ad-hoc team onApply when 2+ chip cards are toggled on", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={onApply} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-builder"),
    );
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-a-critic"),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("roster-picker-apply"));
    });
    expect(onApply).toHaveBeenCalledWith({
      agentIds: ["a-builder", "a-critic"],
    });
    expect(onApply.mock.calls[0][0]).not.toHaveProperty("teamId");
  });

  it("dispatches a teamId-routed onApply when a saved-team chip is committed unchanged", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(<RosterPicker agentId="" teamId="" onApply={onApply} />),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    fireEvent.click(
      await screen.findByTestId("roster-picker-team-t-research-squad"),
    );
    await waitFor(() => {
      expect(checked("roster-picker-agent-a-researcher")).toBe("true");
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("roster-picker-apply"));
    });
    expect(onApply).toHaveBeenCalledWith({
      agentIds: [],
      teamId: "t-research-squad",
    });
  });

  it("clearing the draft to zero agents dispatches an empty agentIds list (unbind)", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(
        <RosterPicker agentId="a-builder" teamId="" onApply={onApply} />,
      ),
    );
    fireEvent.click(await screen.findByTestId("roster-picker-pill"));
    // Active agent should be pre-selected — click the 'No agent' card to clear.
    fireEvent.click(
      await screen.findByTestId("roster-picker-agent-none"),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("roster-picker-apply"));
    });
    expect(onApply).toHaveBeenCalledWith({ agentIds: [] });
  });
});
