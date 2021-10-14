import React from "react";
import { render } from "react-dom";

import { loadIsomorphicModules } from "../common/core/isomorphic";
import { App } from "./app";

if (module.hot) {
    module.hot.accept();
}

void (async () => {
    await loadIsomorphicModules();
    render(<App />, document.querySelector("#app"));
})();
