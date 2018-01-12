import { mount } from "enzyme";

import {
    useSharedAdminLogin,
    createTestStore,
    useSharedNormalLogin,
    forBothAdminsAndNormalUsers,
    withApiMocks,
    BROWSER_HISTORY_REPLACE
} from "__support__/integrated_tests";

import EntitySearch, {
    SearchGroupingOption,
    SearchResultListItem,
    SearchResultsGroup
} from "metabase/containers/EntitySearch";

import AggregationWidget from "metabase/query_builder/components/AggregationWidget";

import { click } from "__support__/enzyme_utils";

import { DETERMINE_OPTIONS } from "metabase/new_query/new_query";

import { getQuery } from "metabase/query_builder/selectors";
import DataSelector from "metabase/query_builder/components/DataSelector";

import { FETCH_DATABASES } from "metabase/redux/metadata";
import NativeQuery from "metabase-lib/lib/queries/NativeQuery";

import { delay } from "metabase/lib/promise";
import * as Urls from "metabase/lib/urls";

import {
    INITIALIZE_QB,
    UPDATE_URL,
    REDIRECT_TO_NEW_QUESTION_FLOW,
    LOAD_METADATA_FOR_CARD,
    QUERY_COMPLETED
} from "metabase/query_builder/actions";

import { MetabaseApi, MetricApi, SegmentApi } from "metabase/services";
import { SET_REQUEST_STATE } from "metabase/redux/requests";

import StructuredQuery from "metabase-lib/lib/queries/StructuredQuery";

import NativeQueryEditor from "metabase/query_builder/components/NativeQueryEditor";
import NewQueryOption from "metabase/new_query/components/NewQueryOption";
import NoDatabasesEmptyState from "metabase/reference/databases/NoDatabasesEmptyState";

describe("new question flow", async () => {
    // test an instance with segments, metrics, etc as an admin
    describe("a rich instance", async () => {
        let metricId = null;
        let segmentId = null;

        beforeAll(async () => {
            // TODO: Move these test metric/segment definitions to a central place
            const metricDef = {
                name: "A Metric",
                description: "For testing new question flow",
                table_id: 1,
                show_in_getting_started: true,
                definition: { database: 1, query: { aggregation: ["count"] } }
            };
            const segmentDef = {
                name: "A Segment",
                description: "For testing new question flow",
                table_id: 1,
                show_in_getting_started: true,
                definition: { database: 1, query: { filter: ["abc"] } }
            };

            // Needed for question creation flow
            useSharedAdminLogin();
            metricId = (await MetricApi.create(metricDef)).id;
            segmentId = (await SegmentApi.create(segmentDef)).id;
        });

        afterAll(async () => {
            useSharedAdminLogin();
            await MetricApi.delete({
                metricId,
                revision_message:
                    "The lifetime of this metric was just a few seconds"
            });
            await SegmentApi.delete({
                segmentId,
                revision_message:
                    "Sadly this segment didn't enjoy a long life either"
            });
        });

        it("redirects /question to /question/new", async () => {
            useSharedNormalLogin();
            const store = await createTestStore();
            store.pushPath("/question");
            mount(store.getAppContainer());
            await store.waitForActions([REDIRECT_TO_NEW_QUESTION_FLOW]);
            expect(store.getPath()).toBe("/question/new");
        });

        it("renders all options for both admins and normal users if metrics & segments exist", async () => {
            await forBothAdminsAndNormalUsers(async () => {
                const store = await createTestStore();

                store.pushPath(Urls.newQuestion());
                const app = mount(store.getAppContainer());
                await store.waitForActions([DETERMINE_OPTIONS]);

                expect(app.find(NewQueryOption).length).toBe(3);
            });
        });

        it("does not show Metrics option for normal users if there are no metrics", async () => {
            useSharedNormalLogin();

            await withApiMocks([[MetricApi, "list", () => []]], async () => {
                const store = await createTestStore();

                store.pushPath(Urls.newQuestion());
                const app = mount(store.getAppContainer());
                await store.waitForActions([DETERMINE_OPTIONS]);

                expect(
                    app
                        .find(NewQueryOption)
                        .filterWhere(c => c.prop("title") === "Metrics").length
                ).toBe(0);
                expect(app.find(NewQueryOption).length).toBe(2);
            });
        });

        it("does not show SQL option for normal user if SQL write permissions are missing", async () => {
            useSharedNormalLogin();

            const disableWritePermissionsForDb = db => ({
                ...db,
                native_permissions: "read"
            });
            const realDbListWithTables = MetabaseApi.db_list_with_tables;

            await withApiMocks(
                [
                    [
                        MetabaseApi,
                        "db_list_with_tables",
                        async () =>
                            (await realDbListWithTables()).map(
                                disableWritePermissionsForDb
                            )
                    ]
                ],
                async () => {
                    const store = await createTestStore();

                    store.pushPath(Urls.newQuestion());
                    const app = mount(store.getAppContainer());
                    await store.waitForActions([DETERMINE_OPTIONS]);

                    expect(app.find(NewQueryOption).length).toBe(2);
                }
            );
        });

        it("redirects to query builder if there are no segments/metrics and no write sql permissions", async () => {
            useSharedNormalLogin();

            const disableWritePermissionsForDb = db => ({
                ...db,
                native_permissions: "read"
            });
            const realDbListWithTables = MetabaseApi.db_list_with_tables;

            await withApiMocks(
                [
                    [MetricApi, "list", () => []],
                    [
                        MetabaseApi,
                        "db_list_with_tables",
                        async () =>
                            (await realDbListWithTables()).map(
                                disableWritePermissionsForDb
                            )
                    ]
                ],
                async () => {
                    const store = await createTestStore();
                    store.pushPath(Urls.newQuestion());
                    mount(store.getAppContainer());
                    await store.waitForActions(
                        BROWSER_HISTORY_REPLACE,
                        INITIALIZE_QB
                    );
                }
            );
        });

        it("shows an empty state if there are no databases", async () => {
            await forBothAdminsAndNormalUsers(async () => {
                await withApiMocks(
                    [[MetabaseApi, "db_list_with_tables", () => []]],
                    async () => {
                        const store = await createTestStore();

                        store.pushPath(Urls.newQuestion());
                        const app = mount(store.getAppContainer());
                        await store.waitForActions([DETERMINE_OPTIONS]);

                        expect(app.find(NewQueryOption).length).toBe(0);
                        expect(app.find(NoDatabasesEmptyState).length).toBe(1);
                    }
                );
            });
        });

        it("lets you start a custom gui question", async () => {
            useSharedNormalLogin();
            const store = await createTestStore();

            store.pushPath(Urls.newQuestion());
            const app = mount(store.getAppContainer());
            await store.waitForActions([DETERMINE_OPTIONS]);

            click(
                app
                    .find(NewQueryOption)
                    .filterWhere(c => c.prop("title") === "Custom")
            );
            await store.waitForActions(
                INITIALIZE_QB,
                UPDATE_URL,
                LOAD_METADATA_FOR_CARD
            );
            expect(getQuery(store.getState()) instanceof StructuredQuery).toBe(
                true
            );
        });

        it("lets you start a custom native question", async () => {
            useSharedNormalLogin();
            // Don't render Ace editor in tests because it uses many DOM methods that aren't supported by jsdom
            // see also parameters.integ.js for more notes about Ace editor testing
            NativeQueryEditor.prototype.loadAceEditor = () => {};

            const store = await createTestStore();

            store.pushPath(Urls.newQuestion());
            const app = mount(store.getAppContainer());
            await store.waitForActions([DETERMINE_OPTIONS]);

            click(
                app
                    .find(NewQueryOption)
                    .filterWhere(c => c.prop("title") === "Native query")
            );
            await store.waitForActions(INITIALIZE_QB);
            expect(getQuery(store.getState()) instanceof NativeQuery).toBe(
                true
            );

            // No database selector visible because in test environment we should
            // only have a single database
            expect(app.find(DataSelector).length).toBe(0);

            // The name of the database should be displayed
            expect(app.find(NativeQueryEditor).text()).toMatch(
                /Sample Dataset/
            );
        });

        it("lets you start a question from a metric", async () => {
            useSharedNormalLogin();
            const store = await createTestStore();

            store.pushPath(Urls.newQuestion());
            const app = mount(store.getAppContainer());
            await store.waitForActions([DETERMINE_OPTIONS]);

            click(
                app
                    .find(NewQueryOption)
                    .filterWhere(c => c.prop("title") === "Metrics")
            );
            await store.waitForActions(FETCH_DATABASES);
            await store.waitForActions([SET_REQUEST_STATE]);
            expect(store.getPath()).toBe("/question/new/metric");

            const entitySearch = app.find(EntitySearch);
            const viewByCreator = entitySearch
                .find(SearchGroupingOption)
                .last();
            expect(viewByCreator.text()).toBe("Creator");
            click(viewByCreator);
            expect(store.getPath()).toBe(
                "/question/new/metric?grouping=creator"
            );

            const group = entitySearch.find(SearchResultsGroup);
            expect(group.prop("groupName")).toBe("Bobby Tables");

            const metricSearchResult = group
                .find(SearchResultListItem)
                .filterWhere(item => /A Metric/.test(item.text()));
            click(metricSearchResult.childAt(0));

            await store.waitForActions([INITIALIZE_QB, QUERY_COMPLETED]);
            await delay(100); // Trying to address random CI failures with a small delay

            expect(
                app
                    .find(AggregationWidget)
                    .find(".View-section-aggregation")
                    .text()
            ).toBe("A Metric");
        });
    });

    describe("a newer instance", () => {});
});
