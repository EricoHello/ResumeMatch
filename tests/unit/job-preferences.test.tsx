// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobPreferences } from "@/components/job-preferences";
import { clearGuestSession } from "@/lib/session/guest-session";

const SAVED_PREFERENCES = {
  targetLocation: "Seattle, WA",
  additionalLocations: [],
  radiusMiles: 25,
  workArrangement: "any" as const,
  minimumSalary: 120_000,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signedInUser() {
  return {
    uid: "verified-user",
    getIdToken: vi.fn().mockResolvedValue("fresh-firebase-token"),
  } as unknown as User;
}

describe("JobPreferences", () => {
  beforeEach(() => {
    clearGuestSession();
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Unexpected network request"))),
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads returning-user preferences and continues without a redundant write", async () => {
    const user = signedInUser();
    const onReadyChange = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
    );

    render(
      <JobPreferences
        identity={{ kind: "user", user }}
        onReadyChange={onReadyChange}
      />,
    );

    expect(
      await screen.findByDisplayValue(SAVED_PREFERENCES.targetLocation),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("120000")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer fresh-firebase-token" },
        cache: "no-store",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Continue with saved preferences",
      }),
    );

    await waitFor(() =>
      expect(onReadyChange).toHaveBeenLastCalledWith(SAVED_PREFERENCES),
    );
    expect(
      screen.queryByRole("heading", { name: "Ready for AI Analysis" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates edited signed-in preferences with a fresh bearer token", async () => {
    const user = signedInUser();
    const onReadyChange = vi.fn();
    const fetchMock = vi.mocked(fetch);
    const updatedPreferences = {
      ...SAVED_PREFERENCES,
      additionalLocations: ["Portland, OR"],
      radiusMiles: 50,
      workArrangement: "hybrid" as const,
      minimumSalary: 135_000,
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { preferences: SAVED_PREFERENCES } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { preferences: updatedPreferences } }),
      );

    render(
      <JobPreferences
        identity={{ kind: "user", user }}
        onReadyChange={onReadyChange}
      />,
    );

    const salary = await screen.findByDisplayValue("120000");
    fireEvent.click(screen.getByRole("button", { name: /add another city/i }));
    fireEvent.change(screen.getByLabelText("Additional city 1"), {
      target: { value: "Portland, OR" },
    });
    fireEvent.change(screen.getByLabelText("Search radius"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
    fireEvent.change(salary, { target: { value: "135000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1];
    expect(request).toEqual(
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer fresh-firebase-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedPreferences),
      }),
    );
    await waitFor(() =>
      expect(onReadyChange).toHaveBeenLastCalledWith(updatedPreferences),
    );
    expect(
      screen.queryByRole("heading", { name: "Ready for AI Analysis" }),
    ).toBeNull();
    expect(user.getIdToken).toHaveBeenCalledTimes(2);
  });

  it("keeps guest preferences in the tab session without calling the API", async () => {
    const onReadyChange = vi.fn();
    const fetchMock = vi.mocked(fetch);
    const view = render(
      <JobPreferences
        identity={{ kind: "guest" }}
        onReadyChange={onReadyChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Target city or location"), {
      target: { value: "Remote" },
    });
    fireEvent.change(screen.getByLabelText("Minimum acceptable salary"), {
      target: { value: "99000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(onReadyChange).toHaveBeenLastCalledWith({
        targetLocation: "Remote",
        additionalLocations: [],
        radiusMiles: 25,
        workArrangement: "any",
        minimumSalary: 99000,
      }),
    );
    expect(
      screen.queryByRole("heading", { name: "Ready for AI Analysis" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("resumematch:guest-session:v1")).toContain(
      '"targetLocation":"Remote"',
    );

    view.unmount();
    render(
      <JobPreferences
        identity={{ kind: "guest" }}
        onReadyChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Remote")).toBeTruthy();
    expect(screen.getByDisplayValue("99000")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
