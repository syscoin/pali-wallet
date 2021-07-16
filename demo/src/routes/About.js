export default function About() {
  return (
    <section>
      <div className="inner">
        <h1>About / Documentation</h1>
        <p className="c">
        SysMint was designed by Syscoin Foundation, and developed by Pollum Labs
        (previously Quan Digital) - a company that has a long term relationship 
        with Syscoin. The main goal for SysMint is to enable users to access the
        token platform features of Syscoin LUX (4.2) easily. We built this 
        application with a simple and secure user-experience in mind, to be a 
        non-custodial portal enabling any SYS owner to harness many of these 
        features without having to code, deeply understand the underlying 
        blockchain, or be a “power user”. It also provides access to some more 
        advanced features like Aux Fees and Notary. Use it as you desire, and 
        enjoy!
        </p>
        <p className="c">
        We are constantly improving this application. If you have questions, 
        ideas to improve SysMint, or you believe you have identified a bug, 
        reach-out to us in the official Syscoin Discord on {" "}
        <a href="#">the xxxxx channel. </a> 
        We appreciate your feedback!{" "}
        </p>
        <blockquote className="c">
        SysMint itself is pretty straightforward. An explanation of each 
        functionality is available in its respective area. It's now possible to
        easily create Syscoin Platform Tokens; Fungible tokens like points or 
        currencies, NFT's, special fractional NFT's, and tools that make it 
        easier for token issuers to manage their creations. Have fun exploring!
        </blockquote>
        <p>This application was built using the Pali Wallet API. To build your 
          own DApp powered by Syscoin Core, refer to the Pali Wallet docs. The 
          API was designed to be intuitive. The learning curve will be minimal 
          if you're familiar with Web3Js and Metamask.
        </p>
        <h2>If you want to learn more about Syscoin Core and its SDK, 
          syscoinjs-lib (the lower level base of the Pali Wallet API), refer to 
          the following links.
        </h2>
        <ol>
          <li><a href="https://syscoin.readme.io">Syscoin Core Documentation</a></li>
          <li><a href="https://github.com/syscoin/syscoinjs-lib">syscoinjs-lib</a></li>
          <li><a href="https://github.com/syscoin/syscoinjs-lib-examples">syscoinjs-lib-examples</a></li>
          <li><a href="https://discord.gg/RkK2AXD">Official Syscoin Discord chat</a></li>
          <li><a href="https://support.syscoin.org/">Syscoin Community Wiki</a></li>
        </ol>

      </div>
    </section>
  );
}
