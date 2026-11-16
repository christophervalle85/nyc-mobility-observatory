# Manhattan 2D map

Status: the 2D map and on-demand 3D are implemented. GitHub Pages is planned separately.

## Experience

Open on a north-up view of Manhattan with the Hudson and East Rivers, Central Park, the street grid, and nearby shorelines for context. Use the existing navy map background, muted streets and green space, and the current map controls and selection accents. Label major features sparingly so the search and mobility panels remain easy to read.

Put a circular **3D** button immediately beside the existing overview button at bottom right. When 3D is active it reads **2D**. Show the 2D map during 3D startup and on 3D failure. Switching back releases the live scene and restores the previous 2D view. Preserve the selected area, selected subway station, and open dashboard when switching. The overview button keeps its current Show all NYC and return behavior.

## Data and integration

Use the existing NYC City Planning land geometry for the shoreline and TLC geometry for searchable and selectable areas. Generate a compact, versioned street and park asset from [NYC Street Centerline](https://data.cityofnewyork.us/d/inkn-q76z) and [NYC Parks Properties](https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve) for all five boroughs. Use [U.S. Census Bureau 2025 TIGER/Line](https://www.census.gov/geographies/mapping-files/2025/geo/tiger-line-file.html) for New Jersey state and water polygons, road centerlines, and selected park boundaries. A stationary water texture and waterway labels help distinguish the rivers and harbor from land. Record the source versions, usage and preprocessing in provenance and link it from the map. Ship the processed geography with the app. TLC geography continues to define the selectable areas.

Keep 2D rendering and navigation in a separate stage module. Use Canvas 2D for generalised vector layers and HTML for controls. Reuse the existing area, station and dashboard state across both views. Gate Cesium startup and preloading on the explicit 3D action. Keep the existing quota and failure protections while allowing a normal return to 2D and later re-entry into 3D. A missing 3D token, failed imagery request or unsupported device leaves the 2D map usable. A failed optional street or park asset leaves the shoreline and TLC data usable. Use the existing public client token configuration for 3D. The 2D stage contacts only the app's host.

## Acceptance checks

- The app opens on Manhattan at desktop and narrow sizes, with a recognizable shoreline, street grid and Central Park. Map imagery requests remain at zero until 3D is requested.
- Both controls fit in the bottom-right rail. Keyboard users can switch modes and use overview. The 3D action shows a loading state and recovers to 2D when imagery fails.
- Search, zoom-to-area, the NYC overview, area highlights, and subway station markers work in 2D. An area outside Manhattan remains reachable through search or overview.
- Switching to 3D and back preserves the selected area, station, and dashboard dates and restores the previous 2D extent. Switching back during loading cancels the pending transition. Browser tests cover these cases with a simulated adapter, plus unavailable-token and failed-3D behavior. Live imagery verification needs a configured environment.
- Verify asset size, data provenance, type checking, unit tests, and a production build. Check the initial map and control placement in the browser before proposing a merge.

## Delivery

1. Verify the source geography and review a rendered 2D preview on the `manhattan-2d-map` branch.
2. Connect mode switching, run the browser checks, and verify a live 3D session. Review the rendered result before integrating. Reverting the feature branch change restores the existing 3D startup path.
3. After the map passes those checks, configure [GitHub Pages with GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). Build and test under the repository URL prefix, including data requests and Cesium assets. The current verification build deliberately omits the imagery token. Add a separate production build path and configure a public read-only Cesium token for the deployed origin if the hosted site offers live 3D.
4. Deploy on changes to `main` and from a successful mobility publish using an explicit workflow handoff. The refresh workflow uses `GITHUB_TOKEN`, so its data commit will not trigger an ordinary push-based deployment. Verify the hosted URL on another device, then verify that a successful data release updates it without a manual redeploy. Deploy the processed dashboard assets from the repository. The raw `.data` folder is unnecessary for hosting.
